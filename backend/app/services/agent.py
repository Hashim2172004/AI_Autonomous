"""The scenario-generation workflow behind ``/generation/runs``.

It is a fixed pipeline (analyse, retrieve, generate, validate, combine, save, simulate,
predict, rank, report) that records its progress on the run row so the UI can poll it.
No external language model is used; every step is deterministic and runs locally.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import traceback
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal
from ..models import GenerationRun, Scenario, ScenarioRelationship, System, iso, utcnow
from . import knowledge, llm, ml
from .generator import analyse_system, expand_combinations, generate_scenarios, validate_scenarios
from .scenarios import create_prediction, run_simulation, save_generated, system_to_dict

log = logging.getLogger(__name__)

RULES_PROVIDER = "rule-engine"
RULES_MODEL = "built-in"


def provider_info() -> tuple[str, str]:
    """(provider, model) the agent will use for new runs."""
    if llm.is_configured():
        return "anthropic", llm.model_name()
    return RULES_PROVIDER, RULES_MODEL
NO_LLM_REASON = "no language-model API key is configured, so the summary was assembled from templates and the simulation figures"

STEPS = [
    ("analyze", "Analyse the system"),
    ("retrieve", "Retrieve knowledge"),
    ("generate", "Generate scenarios"),
    ("validate", "Validate and repair"),
    ("expand", "Expand into combinations"),
    ("save", "Save scenarios"),
    ("simulate", "Simulate every scenario"),
    ("predict", "Predict with the ML model"),
    ("rank", "Assess risk and rank"),
    ("report", "Write the report"),
]

_STOPWORDS = set(
    "the a an and or of to in for on with at by from is are was were be been this that these those it its as if what "
    "will would could should may can than then into over under about their there which who whom while during".split()
)


def _tokens(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z]{4,}", text.lower()) if word not in _STOPWORDS}


class Tracker:
    """Writes step status and events to the run row, committing after every change."""

    def __init__(self, db: Session, run: GenerationRun):
        self.db = db
        self.run = run
        self.run.steps = [
            {"node": node, "label": label, "status": "pending", "message": "", "runs": 0} for node, label in STEPS
        ]
        self.run.events = []
        self.run.stats = {}
        self.db.commit()

    def event(self, node: str | None, status: str, message: str) -> None:
        self.run.events = [*self.run.events, {"at": iso(utcnow()), "node": node, "status": status, "message": message}]
        self.db.commit()

    def step(self, node: str, status: str, message: str = "") -> None:
        steps = []
        for item in self.run.steps:
            if item["node"] == node:
                item = {**item, "status": status, "message": message or item["message"]}
                if status == "running":
                    item["runs"] = item["runs"] + 1
            steps.append(item)
        self.run.steps = steps
        self.db.commit()

    def stat(self, **values: Any) -> None:
        self.run.stats = {**self.run.stats, **values}
        self.db.commit()


def _attach_knowledge(scenarios: list[dict[str, Any]], passages: list[dict[str, Any]]) -> int:
    """Link each scenario to the passage that shares the most vocabulary with it."""
    linked = 0
    passage_tokens = [(passage, _tokens(passage["text"])) for passage in passages]
    for scenario in scenarios:
        words = _tokens(f"{scenario['title']} {scenario['description']}")
        best, best_overlap = None, 0
        for passage, tokens in passage_tokens:
            overlap = len(words & tokens)
            if overlap > best_overlap:
                best, best_overlap = passage, overlap
        if best and best_overlap >= 3:
            snippet = " ".join(best["text"].split())[:180]
            scenario["assumptions"].append(f"Informed by knowledge-base document “{best['title']}”: {snippet}…")
            scenario["confidence"] = round(min(0.95, scenario["confidence"] + 0.05), 2)
            linked += 1
    return linked


def build_report(
    system: System, scenarios: list[Scenario], analysis: dict[str, Any], simulated: int, fallback_reason: str = NO_LLM_REASON
) -> dict[str, Any]:
    rated = [s for s in scenarios if s.risk_score is not None]
    ranked = sorted(rated, key=lambda s: s.rank if s.rank is not None else 999)
    high = [s for s in rated if s.risk_level in ("high", "critical")]
    top = ranked[:3]

    if not rated:
        return {
            "source": "template",
            "model": None,
            "fallback_reason": fallback_reason,
            "executive_summary": f"{len(scenarios)} scenarios were generated for {system.name} but none could be simulated.",
            "key_findings": [],
            "top_risks": [],
            "recommended_actions": [],
            "open_questions": analysis.get("missing_information", []),
            "caveats": ["No simulation completed, so no risk figures are available."],
        }

    def metrics_of(s: Scenario) -> dict[str, Any]:
        sim = s._simulation  # attached by the pipeline
        return sim.metrics if sim and sim.metrics else {}

    key_findings = [
        f"{len(high)} of {len(rated)} scenarios are rated high or critical risk."
        if high else f"None of the {len(rated)} simulated scenarios is rated high or critical risk.",
    ]
    worst_profit = min(rated, key=lambda s: metrics_of(s).get("profit_change_pct", 0))
    m = metrics_of(worst_profit)
    key_findings.append(
        f"The largest profit effect comes from “{worst_profit.title}”: {m.get('profit_change_pct', 0):+.1f}% on average, "
        f"and {m.get('profit_change_p5', 0):+.1f}% in a bad case."
    )
    worst_service = max(rated, key=lambda s: metrics_of(s).get("unmet_demand_pct", 0))
    ms = metrics_of(worst_service)
    if ms.get("unmet_demand_pct", 0) > 0.5:
        key_findings.append(
            f"“{worst_service.title}” leaves {ms['unmet_demand_pct']:.1f}% of demand unserved, "
            f"the largest service gap of the set."
        )
    compounds = [s for s in rated if (s.details or {}).get("kind") == "compound"]
    if compounds:
        top_compound = max(compounds, key=lambda s: s.risk_score or 0)
        compound_score = top_compound.risk_score or 0
        single_score = max(((s.risk_score or 0) for s in rated if s not in compounds), default=0)
        if compound_score > single_score:
            comparison = f"higher than any single event (top single event: {single_score:.0f}/100)"
        elif compound_score >= single_score - 5:
            comparison = f"close to the riskiest single event ({single_score:.0f}/100)"
        else:
            comparison = None
        if comparison:
            key_findings.append(
                f"Combined events matter: “{top_compound.title}” scores {compound_score:.0f}/100, {comparison}."
            )

    top_risks = []
    for scenario in top:
        sim_metrics = metrics_of(scenario)
        top_risks.append({
            "scenario_id": scenario.scenario_key,
            "title": scenario.title,
            "why_it_matters": (
                f"risk score {scenario.risk_score:.0f}/100 ({scenario.risk_level}), profit "
                f"{sim_metrics.get('profit_change_pct', 0):+.1f}% and {sim_metrics.get('unmet_demand_pct', 0):.1f}% of demand unserved."
            ),
        })

    actions, seen = [], set()
    for position, scenario in enumerate(top):
        sim = scenario._simulation
        for mitigation in (sim.risk_analysis or {}).get("mitigations", [])[:2] if sim else []:
            if mitigation in seen:
                continue
            seen.add(mitigation)
            actions.append({
                "priority": "high" if position < 2 else "medium",
                "action": mitigation,
                "rationale": f"Reduces exposure to “{scenario.title}”.",
            })

    summary = (
        f"{system.name} was tested against {len(scenarios)} what-if scenarios and {simulated} were simulated. "
        f"{len(high)} are rated high or critical risk. The top priority is “{top[0].title}” "
        f"(risk {top[0].risk_score:.0f}/100, {top[0].risk_level})."
    )
    return {
        "source": "template",
        "model": None,
        "fallback_reason": fallback_reason,
        "executive_summary": summary,
        "key_findings": key_findings,
        "top_risks": top_risks,
        "recommended_actions": actions[:6],
        "open_questions": [
            *analysis.get("missing_information", []),
            "Do the estimated likelihoods match your own incident history?",
            "Which of the high-priority scenarios already have a tested response plan?",
        ],
        "caveats": [
            "The simulator is a simplified single-stage model; it ignores supplier networks and customer behaviour.",
            "Likelihoods are rule-based estimates, not measured frequencies.",
            "The ML prediction is trained on synthetic simulator output, so it cannot be more accurate than the simulator.",
            "Mitigations are generic suggestions per risk category and must be checked against local conditions.",
        ],
    }


def execute_run(run_id: int) -> None:
    """Entry point for the worker thread."""
    db = SessionLocal()
    started = time.monotonic()
    try:
        run = db.get(GenerationRun, run_id)
        if run is None:
            return
        _execute(db, run, started)
    except Exception as error:  # noqa: BLE001
        log.error("Generation run %s failed: %s\n%s", run_id, error, traceback.format_exc())
        db.rollback()
        run = db.get(GenerationRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error = str(error)[:500]
            run.completed_at = utcnow()
            run.steps = [
                {**s, "status": "failed", "message": run.error} if s["status"] == "running" else s for s in run.steps
            ]
            run.events = [*run.events, {"at": iso(utcnow()), "node": None, "status": "failed", "message": run.error}]
            db.commit()
    finally:
        db.close()


def _execute(db: Session, run: GenerationRun, started: float) -> None:
    system = db.get(System, run.system_id)
    options = run.options
    tracker = Tracker(db, run)
    run.status = "running"
    db.commit()
    system_data = system_to_dict(system)
    user_id = run.user_id

    # 1. analyse
    tracker.step("analyze", "running")
    analysis = analyse_system(system_data)
    run.system_analysis = analysis
    tracker.step("analyze", "completed", f"{len(analysis['vulnerabilities'])} exposure area(s) identified")
    tracker.event("analyze", "completed", analysis["summary"])

    # 2. retrieve knowledge
    passages: list[dict[str, Any]] = []
    if options.get("use_knowledge", True):
        tracker.step("retrieve", "running")
        query = " ".join(
            filter(None, [system.name, system.industry, system.description, system.objective, system.current_conditions])
        )
        hits = knowledge.search(db, user_id, query, top_k=5, system_id=system.id)
        passages = [{"title": h.title, "score": h.score, "text": h.text} for h in hits]
        run.retrieved_knowledge = passages
        if passages:
            message = f"{len(passages)} passage(s) retrieved from {len({h.document_id for h in hits})} document(s)"
        else:
            message = "No relevant passages in the knowledge base"
        tracker.step("retrieve", "completed", message)
        tracker.event("retrieve", "completed", message)
    else:
        tracker.step("retrieve", "skipped", "Knowledge base disabled for this run")

    # 3. generate
    tracker.step("generate", "running")
    existing_titles = set(
        db.scalars(select(Scenario.title).where(Scenario.system_id == system.id, Scenario.user_id == user_id)).all()
    )
    usage = llm.Usage()
    use_llm = run.options.get("llm_provider") == "anthropic" and llm.is_configured()
    generated: list[dict[str, Any]] = []
    if use_llm:
        try:
            generated = llm.draft_scenarios(system_data, run.requested_count, existing_titles, passages, usage)
            for item in generated:
                item.setdefault("assumptions", [])
            tracker.event("generate", "running", f"Claude ({llm.model_name()}) drafted {len(generated)} scenario(s)")
        except llm.LlmError as error:
            usage.errors.append(str(error))
            tracker.event("generate", "running", f"LLM drafting failed ({error}); using the built-in rules instead")
            generated = []
    if not generated:
        generated = generate_scenarios(system_data, run.requested_count, existing_titles, salt=f"run{run.id}")
    for index, item in enumerate(generated, start=1):
        item["scenario_key"] = f"S{index}"
    linked = _attach_knowledge(generated, passages) if passages else 0
    tracker.stat(generated=len(generated), llm_calls=usage.calls, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
    message = f"{len(generated)} scenario(s) drafted" + (f", {linked} grounded in the knowledge base" if linked else "")
    tracker.step("generate", "completed", message)
    tracker.event("generate", "completed", message)

    # 4. validate
    tracker.step("validate", "running")
    kept, report = validate_scenarios(generated, system_data)
    repaired = len({i["scenario_id"] for i in report["issues"] if i["outcome"] == "repaired"})
    run.validation_report = report
    tracker.stat(repaired=repaired, dropped=len(report["dropped"]))
    message = (
        f"{len(report['issues'])} issue(s): {repaired} scenario(s) repaired, {len(report['dropped'])} dropped"
        if report["issues"] else "All scenarios passed validation"
    )
    tracker.step("validate", "completed", message)
    tracker.event("validate", "completed", message)

    # 5. expand
    compounds: list[dict[str, Any]] = []
    if options.get("expand", True) and len(kept) >= 2:
        tracker.step("expand", "running")
        wanted = max(1, min(4, run.requested_count // 3))
        compounds = expand_combinations(kept, wanted)
        for index, compound in enumerate(compounds, start=1):
            compound["scenario_key"] = f"C{index}"
        compounds_kept, compound_report = validate_scenarios(compounds, system_data)
        if compound_report["issues"]:
            run.validation_report = {
                "issues": [*report["issues"], *compound_report["issues"]],
                "dropped": [*report["dropped"], *compound_report["dropped"]],
            }
        compounds = compounds_kept
        message = f"{len(compounds)} combined scenario(s) added" if compounds else "No compatible combinations found"
        tracker.step("expand", "completed", message)
        tracker.event("expand", "completed", message)
    else:
        tracker.step("expand", "skipped", "Not needed")
    tracker.stat(expanded=len(compounds))

    # 6. save
    tracker.step("save", "running")
    base_saved = save_generated(db, user_id, system, kept, source="ai_agent", run_id=run.id)
    compound_saved = save_generated(db, user_id, system, compounds, source="ai_agent", run_id=run.id, key_prefix="C")
    for compound, record in zip(compounds, compound_saved):
        for component_index in compound.get("components", []):
            db.add(
                ScenarioRelationship(
                    run_id=run.id,
                    source_scenario_id=base_saved[component_index].id,
                    target_scenario_id=record.id,
                )
            )
    db.commit()
    all_saved = [*base_saved, *compound_saved]
    tracker.stat(saved=len(all_saved))
    tracker.step("save", "completed", f"{len(all_saved)} scenario(s) saved")
    tracker.event("save", "completed", f"{len(all_saved)} scenario(s) saved to the workspace")

    # 7. simulate
    tracker.step("simulate", "running")
    simulations = {}
    failures = 0
    for scenario in all_saved:
        simulation = run_simulation(db, scenario, user_id)
        scenario._simulation = simulation
        simulations[scenario.id] = simulation
        if simulation.status != "completed":
            failures += 1
        tracker.event("simulate", simulation.status, f"{scenario.scenario_key} · {scenario.title}: {simulation.status}")
    done = len(all_saved) - failures
    tracker.stat(simulations=done)
    tracker.step("simulate", "completed", f"{done} simulated" + (f", {failures} failed" if failures else ""))

    # 8. predict
    tracker.step("predict", "running", "Preparing the prediction model")
    predictions = 0
    try:
        if ml.latest_model(db) is None:
            tracker.event("predict", "running", "Training the surrogate model on synthetic simulations (a few seconds)")
        for scenario in all_saved:
            if simulations[scenario.id].status == "completed":
                create_prediction(db, scenario)
                predictions += 1
        tracker.step("predict", "completed", f"{predictions} prediction(s) made")
        tracker.event("predict", "completed", f"{predictions} ML prediction(s) made")
    except Exception as error:  # noqa: BLE001 - optional step
        db.rollback()
        tracker.step("predict", "failed", str(error)[:200])
        tracker.event("predict", "failed", f"ML prediction skipped: {error}")
    tracker.stat(predictions=predictions)

    # 9. rank
    tracker.step("rank", "running")
    rated = [s for s in all_saved if s.risk_score is not None]
    for scenario in rated:
        scenario.rank_score = round(
            0.6 * scenario.risk_score + 0.25 * (scenario.impact_score or 0) + 0.15 * (scenario.confidence or 0.5) * 100, 1
        )
    for position, scenario in enumerate(sorted(rated, key=lambda s: s.rank_score, reverse=True), start=1):
        scenario.rank = position
    db.commit()
    tracker.stat(risk_reports=len(rated))
    tracker.step("rank", "completed", f"{len(rated)} scenario(s) scored and ranked")
    tracker.event("rank", "completed", f"{len(rated)} scenario(s) scored and ranked")

    # 10. report
    tracker.step("report", "running")
    reason = NO_LLM_REASON
    report = None
    if use_llm:
        figures = []
        for scenario in sorted([s for s in all_saved if s.rank is not None], key=lambda s: s.rank)[:10]:
            m = (scenario._simulation.metrics or {}) if getattr(scenario, "_simulation", None) else {}
            figures.append({
                "scenario_id": scenario.scenario_key, "title": scenario.title, "category": scenario.category,
                "rank": scenario.rank, "risk_level": scenario.risk_level, "risk_score": scenario.risk_score,
                "impact_score": scenario.impact_score, "probability": scenario.parameters.get("probability"),
                "profit_change_pct": m.get("profit_change_pct"), "unmet_demand_pct": m.get("unmet_demand_pct"),
                "avg_delay_days": (m.get("delay") or {}).get("avg_days"),
                "cost_change_pct": (m.get("cost") or {}).get("change_pct"),
            })
        try:
            if not figures:
                raise llm.LlmError("no simulated scenarios to report on")
            report = llm.write_report(system_data, figures, analysis, usage)
            tracker.stat(llm_calls=usage.calls, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
        except llm.LlmError as error:
            reason = f"the LLM request failed ({error})"
            tracker.event("report", "running", f"LLM report failed ({error}); using the template instead")
    if report is None:
        report = build_report(system, all_saved, analysis, done, fallback_reason=reason)
    run.report = report
    tracker.stat(llm_calls=usage.calls, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
    source_label = f"Written by {report['model']}" if report["source"] == "llm" else "Template summary of the simulation figures"
    tracker.step("report", "completed", source_label)
    tracker.event("report", "completed", "Report written")

    run.status = "completed"
    run.completed_at = utcnow()
    tracker.stat(seconds=round(time.monotonic() - started, 1))
    db.commit()


def start_run(run_id: int) -> None:
    if get_settings().inline_runs:
        execute_run(run_id)
        return
    threading.Thread(target=execute_run, args=(run_id,), name=f"generation-run-{run_id}", daemon=True).start()


def fail_interrupted_runs(db: Session) -> None:
    """Runs cannot survive a restart; mark them failed so the UI stops polling them."""
    runs = db.scalars(select(GenerationRun).where(GenerationRun.status.in_(("queued", "running")))).all()
    for run in runs:
        run.status = "failed"
        run.error = "The server restarted while this run was in progress."
        run.completed_at = utcnow()
    if runs:
        db.commit()
