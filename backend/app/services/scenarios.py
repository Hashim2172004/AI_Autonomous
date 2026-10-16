"""Persistence helpers shared by the routers and the generation agent."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Prediction,
    Scenario,
    ScenarioRelationship,
    Simulation,
    System,
    WhatIf,
    iso,
    utcnow,
)
from . import ml
from .generator import _changed_variables
from .simulator import (
    DEFAULT_ASSUMPTIONS,
    assess,
    normalise_assumptions,
    normalise_parameters,
    severity_for,
    simulate,
    summarise,
)

OUTCOME_KEYS = ("profit_change_pct", "total_cost_change_pct", "avg_delay_days", "unmet_demand_pct")


# --- serialisation -----------------------------------------------------------------------------


def system_to_dict(system: System, scenario_count: int | None = None) -> dict[str, Any]:
    data = {
        "id": system.id,
        "name": system.name,
        "industry": system.industry,
        "description": system.description,
        "objective": system.objective,
        "current_conditions": system.current_conditions or "",
        "available_resources": system.available_resources or "",
        "constraints": system.constraints or "",
        "assumptions": system.assumptions or {},
        "created_at": iso(system.created_at),
        "updated_at": iso(system.updated_at),
    }
    if scenario_count is not None:
        data["scenario_count"] = scenario_count
    return data


def scenario_to_summary(scenario: Scenario) -> dict[str, Any]:
    return {
        "id": scenario.id,
        "system_id": scenario.system_id,
        "system_name": scenario.system.name,
        "industry": scenario.system.industry,
        "run_id": scenario.run_id,
        "scenario_key": scenario.scenario_key,
        "title": scenario.title,
        "description": scenario.description,
        "category": scenario.category,
        "status": scenario.status,
        "severity": scenario.severity,
        "source": scenario.source,
        "risk_level": scenario.risk_level,
        "impact_score": scenario.impact_score,
        "risk_score": scenario.risk_score,
        "created_at": iso(scenario.created_at),
    }


def scenario_to_run_row(scenario: Scenario) -> dict[str, Any]:
    """Row shape used by the generation-run results table and the relationship graph."""
    return {
        **scenario_to_summary(scenario),
        "parameters": scenario.parameters,
        "details": scenario.details,
        "confidence": scenario.confidence,
        "rank": scenario.rank,
        "rank_score": scenario.rank_score,
    }


def simulation_to_dict(simulation: Simulation, full: bool = True) -> dict[str, Any]:
    data = {
        "id": simulation.id,
        "scenario_id": simulation.scenario_id,
        "scenario_title": simulation.scenario.title if simulation.scenario else None,
        "status": simulation.status,
        "engine": simulation.engine,
        "iterations": simulation.iterations,
        "impact_score": simulation.impact_score,
        "summary": simulation.summary,
        "error": simulation.error,
        "metrics": simulation.metrics,
        "risk_analysis": simulation.risk_analysis,
        "created_at": iso(simulation.created_at),
        "completed_at": iso(simulation.completed_at),
    }
    if full:
        data.update(
            assumptions=simulation.assumptions,
            timeseries=simulation.timeseries,
            distribution=simulation.distribution,
        )
    return data


def latest_simulation(db: Session, scenario_id: int, completed_only: bool = False) -> Simulation | None:
    stmt = select(Simulation).where(Simulation.scenario_id == scenario_id)
    if completed_only:
        stmt = stmt.where(Simulation.status == "completed")
    return db.scalars(stmt.order_by(Simulation.id.desc()).limit(1)).first()


def _assumptions_match(model_assumptions: dict[str, Any], used: dict[str, Any]) -> bool:
    ignored = {"seed", "iterations", "currency"}
    return all(
        model_assumptions.get(key) == used.get(key)
        for key in DEFAULT_ASSUMPTIONS
        if key not in ignored
    )


def prediction_to_dict(prediction: Prediction) -> dict[str, Any]:
    return {"id": prediction.id, "scenario_id": prediction.scenario_id, "created_at": iso(prediction.created_at), **prediction.payload}


def scenario_to_detail(db: Session, scenario: Scenario) -> dict[str, Any]:
    simulation = latest_simulation(db, scenario.id)
    prediction = db.scalars(
        select(Prediction).where(Prediction.scenario_id == scenario.id).order_by(Prediction.id.desc()).limit(1)
    ).first()

    related: list[dict[str, Any]] = []
    links = db.scalars(
        select(ScenarioRelationship).where(
            (ScenarioRelationship.source_scenario_id == scenario.id)
            | (ScenarioRelationship.target_scenario_id == scenario.id)
        )
    ).all()
    for link in links:
        # If this scenario is the target it is the compound, and the other side is a component.
        other_id = link.source_scenario_id if link.target_scenario_id == scenario.id else link.target_scenario_id
        relation = "component" if link.target_scenario_id == scenario.id else "part_of"
        other = db.get(Scenario, other_id)
        if other is None:
            continue
        related.append({
            "relation": relation,
            "scenario_id": other.id,
            "scenario_key": other.scenario_key,
            "title": other.title,
            "severity": other.severity,
            "probability": (other.parameters or {}).get("probability"),
        })

    simulation_count = db.scalar(select(func.count(Simulation.id)).where(Simulation.scenario_id == scenario.id)) or 0
    what_if_count = db.scalar(select(func.count(WhatIf.id)).where(WhatIf.scenario_id == scenario.id)) or 0

    data = scenario_to_summary(scenario)
    data.update(
        system=system_to_dict(scenario.system),
        parameters=scenario.parameters,
        details=scenario.details or {},
        assumptions=scenario.assumptions or [],
        confidence=scenario.confidence,
        rank=scenario.rank,
        rank_score=scenario.rank_score,
        related=related,
        latest_simulation=simulation_to_dict(simulation) if simulation else None,
        latest_prediction=prediction_to_dict(prediction) if prediction else None,
        simulation_count=simulation_count,
        what_if_count=what_if_count,
        updated_at=iso(scenario.updated_at),
    )
    return data


# --- simulation --------------------------------------------------------------------------------


def effective_assumptions(system: System, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    return normalise_assumptions(overrides, base=system.assumptions or {})


def run_simulation(
    db: Session,
    scenario: Scenario,
    user_id: int,
    overrides: dict[str, Any] | None = None,
) -> Simulation:
    """Simulate a scenario with the system's assumptions and store the result.

    Any failure is recorded on the simulation and the scenario rather than raised.
    """
    assumptions = effective_assumptions(scenario.system, overrides)
    simulation = Simulation(
        user_id=user_id,
        scenario_id=scenario.id,
        status="running",
        iterations=int(assumptions["iterations"]),
        assumptions=assumptions,
    )
    simulation.scenario = scenario
    db.add(simulation)
    db.flush()
    try:
        params = normalise_parameters(scenario.parameters)
        output = simulate(params, assumptions, seed_offset=scenario.id)
        impact, analysis = assess(output, params, scenario.category)
        simulation.metrics = output.metrics
        simulation.timeseries = output.timeseries
        simulation.distribution = output.distribution
        simulation.risk_analysis = analysis
        simulation.impact_score = impact
        simulation.summary = summarise(scenario.title, output, analysis)
        simulation.status = "completed"
        simulation.completed_at = utcnow()
        scenario.status = "completed"
        scenario.risk_level = analysis["risk_level"]
        scenario.risk_score = analysis["risk_score"]
        scenario.impact_score = impact
    except Exception as error:  # noqa: BLE001 - recorded, not raised, so batch runs continue
        simulation.status = "failed"
        simulation.error = str(error)[:500]
        simulation.completed_at = utcnow()
        scenario.status = "failed"
    db.commit()
    db.refresh(simulation)
    return simulation


# --- prediction --------------------------------------------------------------------------------


def create_prediction(db: Session, scenario: Scenario) -> Prediction:
    record = ml.ensure_model(db)
    params = normalise_parameters(scenario.parameters)
    result = ml.predict(db, record, params)

    simulation = latest_simulation(db, scenario.id, completed_only=True)
    simulated: dict[str, float] | None = None
    errors: dict[str, float] | None = None
    match = True
    if simulation and simulation.metrics:
        m = simulation.metrics
        simulated = {
            "profit_change_pct": m["profit_change_pct"],
            "total_cost_change_pct": m["cost"]["change_pct"],
            "avg_delay_days": m["delay"]["avg_days"],
            "unmet_demand_pct": m["unmet_demand_pct"],
        }
        errors = {key: round(result["predicted"][key] - simulated[key], 3) for key in OUTCOME_KEYS}
        match = _assumptions_match(record.meta.get("assumptions", {}), simulation.assumptions or {})

    prediction = Prediction(
        scenario_id=scenario.id,
        model_id=record.id,
        payload={
            "model_id": record.id,
            **result,
            "simulated": simulated,
            "errors": errors,
            "assumptions_match": match,
        },
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return prediction


# --- what-if -----------------------------------------------------------------------------------

_PARAMETER_LABELS = {
    "demand_change_pct": "demand",
    "capacity_change_pct": "capacity",
    "cost_change_pct": "unit cost",
    "duration_days": "duration",
    "recovery_days": "recovery",
    "probability": "probability",
    "volatility": "uncertainty",
}

_COMPARED = (
    # key, label, unit, higher_is_better (None = not judged)
    ("impact_score", "Impact score", "", False),
    ("risk_score", "Risk score", "", False),
    ("profit_change_pct", "Profit change", "%", True),
    ("total_cost_change_pct", "Total cost change", "%", False),
    ("avg_delay_days", "Average delay", "days", False),
    ("unmet_demand_pct", "Unserved demand", "%", False),
    ("peak_utilization_pct", "Peak utilisation", "%", None),
    ("expected_financial_loss", "Expected financial loss", "money", False),
)


def _comparison_values(sim_metrics: dict[str, Any], impact: float, risk: dict[str, Any]) -> dict[str, float]:
    return {
        "impact_score": impact,
        "risk_score": risk["risk_score"],
        "profit_change_pct": sim_metrics["profit_change_pct"],
        "total_cost_change_pct": sim_metrics["cost"]["change_pct"],
        "avg_delay_days": sim_metrics["delay"]["avg_days"],
        "unmet_demand_pct": sim_metrics["unmet_demand_pct"],
        "peak_utilization_pct": sim_metrics["resources"]["peak_utilization_pct"],
        "expected_financial_loss": sim_metrics["cost"]["expected_financial_loss"],
    }


def create_what_if(
    db: Session,
    scenario: Scenario,
    user_id: int,
    name: str | None,
    parameter_changes: dict[str, Any],
    assumption_changes: dict[str, Any],
) -> WhatIf:
    original = latest_simulation(db, scenario.id, completed_only=True)
    if original is None:
        original = run_simulation(db, scenario, user_id)
        if original.status != "completed":
            raise RuntimeError(original.error or "The original scenario could not be simulated.")

    new_params = normalise_parameters(parameter_changes, base=scenario.parameters)
    base_assumptions = original.assumptions or effective_assumptions(scenario.system)
    new_assumptions = normalise_assumptions(assumption_changes, base=base_assumptions)

    output = simulate(new_params, new_assumptions, seed_offset=scenario.id)
    impact, risk = assess(output, new_params, scenario.category)

    before = _comparison_values(original.metrics, original.impact_score, original.risk_analysis)
    after = _comparison_values(output.metrics, impact, risk)
    rows = []
    for key, label, unit, higher_is_better in _COMPARED:
        delta = round(after[key] - before[key], 4)
        if abs(delta) < 0.005:
            verdict = "unchanged"
        elif higher_is_better is None:
            verdict = "changed"
        else:
            verdict = "better" if (delta > 0) == higher_is_better else "worse"
        rows.append({
            "key": key,
            "label": label,
            "unit": unit,
            "original": round(before[key], 3),
            "updated": round(after[key], 3),
            "delta": delta,
            "delta_pct": round(delta / abs(before[key]) * 100, 1) if abs(before[key]) > 1e-9 else None,
            "verdict": verdict,
        })

    same_noise = all(
        original.assumptions.get(k) == new_assumptions.get(k) for k in ("seed", "iterations", "horizon_days", "demand_noise")
    )
    original_ts = original.timeseries
    comparison = {
        "currency": new_assumptions["currency"],
        "common_random_numbers": same_noise,
        "risk_level": {"original": original.risk_analysis["risk_level"], "updated": risk["risk_level"]},
        "metrics": rows,
        "series": {
            "days": output.timeseries["days"],
            "baseline_output": output.timeseries["baseline_output"],
            "original_output": original_ts["scenario_output"],
            "updated_output": output.timeseries["scenario_output"],
            "original_cumulative_profit": original_ts["average_cumulative_profit"],
            "updated_cumulative_profit": output.timeseries["average_cumulative_profit"],
        },
    }

    changed_names = [
        f"{_PARAMETER_LABELS[key]} {value:g}"
        for key, value in new_params.items()
        if float(value) != float(scenario.parameters.get(key, value))
    ]
    changed_names += [key.replace("_", " ") for key in assumption_changes]
    existing = db.scalar(select(func.count(WhatIf.id)).where(WhatIf.scenario_id == scenario.id)) or 0
    label = (name or "").strip() or f"What-if {existing + 1}: " + (", ".join(changed_names[:3]) or "no change")

    what_if = WhatIf(
        scenario_id=scenario.id,
        name=label[:200],
        parameters=parameter_changes,
        assumptions=assumption_changes,
        comparison=comparison,
    )
    db.add(what_if)
    db.commit()
    db.refresh(what_if)
    return what_if


def what_if_to_dict(what_if: WhatIf) -> dict[str, Any]:
    return {
        "id": what_if.id,
        "scenario_id": what_if.scenario_id,
        "name": what_if.name,
        "parameters": what_if.parameters,
        "assumptions": what_if.assumptions,
        "comparison": what_if.comparison,
        "created_at": iso(what_if.created_at),
    }


# --- saving generated scenarios ----------------------------------------------------------------


def save_generated(
    db: Session,
    user_id: int,
    system: System,
    items: list[dict[str, Any]],
    source: str,
    run_id: int | None = None,
    key_prefix: str = "S",
    start_index: int = 1,
) -> list[Scenario]:
    saved: list[Scenario] = []
    for offset, item in enumerate(items):
        params = normalise_parameters(item["parameters"])
        severity, _score = severity_for(params)
        details = dict(item.get("details") or {})
        details["changed_variables"] = _changed_variables(params, effective_assumptions(system))
        scenario = Scenario(
            user_id=user_id,
            system_id=system.id,
            run_id=run_id,
            scenario_key=item.get("scenario_key") or f"{key_prefix}{start_index + offset}",
            title=item["title"][:300],
            description=item["description"],
            category=item["category"],
            status="draft",
            severity=severity,
            source=source,
            parameters=params,
            details=details,
            assumptions=list(item.get("assumptions") or []),
            confidence=item.get("confidence"),
        )
        scenario.system = system
        db.add(scenario)
        saved.append(scenario)
    db.flush()
    return saved
