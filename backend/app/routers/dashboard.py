from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from ..deps import CurrentUser, DbSession
from ..models import GenerationRun, Scenario, Simulation, System, iso
from ..services import ml

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RISK_ORDER = ["critical", "high", "medium", "low"]


@router.get("/summary")
def summary(db: DbSession, user: CurrentUser):
    scenarios = db.scalars(
        select(Scenario).options(joinedload(Scenario.system)).where(Scenario.user_id == user.id)
    ).unique().all()
    systems = db.scalar(select(func.count(System.id)).where(System.user_id == user.id)) or 0
    completed_simulations = (
        db.scalar(
            select(func.count(Simulation.id)).where(Simulation.user_id == user.id, Simulation.status == "completed")
        )
        or 0
    )

    rated = [s for s in scenarios if s.risk_level]
    impacts = [s.impact_score for s in scenarios if s.impact_score is not None]
    totals = {
        "total_scenarios": len(scenarios),
        "total_systems": systems,
        "high_risk_scenarios": sum(1 for s in rated if s.risk_level in ("high", "critical")),
        "completed_simulations": completed_simulations,
        "average_impact": round(sum(impacts) / len(impacts), 1) if impacts else None,
    }

    risk_counts = {level: sum(1 for s in rated if s.risk_level == level) for level in RISK_ORDER}
    category_counts: dict[str, int] = {}
    for scenario in scenarios:
        category_counts[scenario.category] = category_counts.get(scenario.category, 0) + 1

    by_impact = sorted((s for s in scenarios if s.impact_score is not None), key=lambda s: -s.impact_score)[:8]
    by_risk = sorted((s for s in scenarios if s.risk_score is not None), key=lambda s: -s.risk_score)

    # Latest completed simulation of the highest-risk scenarios, for the comparison table.
    comparison = []
    for scenario in by_risk[:6]:
        simulation = db.scalars(
            select(Simulation)
            .where(Simulation.scenario_id == scenario.id, Simulation.status == "completed")
            .order_by(Simulation.id.desc())
            .limit(1)
        ).first()
        if simulation is None or not simulation.metrics:
            continue
        m = simulation.metrics
        comparison.append({
            "scenario_id": scenario.id,
            "title": scenario.title,
            "risk_level": scenario.risk_level,
            "profit_change_pct": m["profit_change_pct"],
            "worst_case_profit_change_pct": m["worst_case"]["profit_change_pct"],
            "best_case_profit_change_pct": m["best_case"]["profit_change_pct"],
            "total_cost_change_pct": m["cost"]["change_pct"],
            "avg_delay_days": m["delay"]["avg_days"],
            "unmet_demand_pct": m["unmet_demand_pct"],
            "peak_utilization_pct": m["resources"]["peak_utilization_pct"],
            "expected_financial_loss": m["cost"]["expected_financial_loss"],
            "currency": m["currency"],
        })

    latest_run = db.scalars(
        select(GenerationRun)
        .options(joinedload(GenerationRun.system))
        .where(GenerationRun.user_id == user.id, GenerationRun.status == "completed", GenerationRun.report.is_not(None))
        .order_by(GenerationRun.id.desc())
        .limit(1)
    ).first()

    recent = sorted(scenarios, key=lambda s: s.id, reverse=True)[:6]
    return {
        "totals": totals,
        "risk_distribution": [{"label": level, "count": count} for level, count in risk_counts.items() if count],
        "category_distribution": [
            {"label": label, "count": count}
            for label, count in sorted(category_counts.items(), key=lambda item: -item[1])
        ],
        "top_impact": [
            {"scenario_id": s.id, "title": s.title, "impact_score": s.impact_score, "risk_level": s.risk_level}
            for s in by_impact
        ],
        "risk_matrix": [
            {
                "scenario_id": s.id,
                "title": s.title,
                "probability": (s.parameters or {}).get("probability", 0),
                "impact": s.impact_score,
                "risk_score": s.risk_score,
                "risk_level": s.risk_level,
            }
            for s in by_risk
            if s.impact_score is not None
        ],
        "comparison": comparison,
        "recent_scenarios": [
            {
                "id": s.id,
                "title": s.title,
                "system_name": s.system.name,
                "status": s.status,
                "risk_level": s.risk_level,
                "impact_score": s.impact_score,
                "created_at": iso(s.created_at),
            }
            for s in recent
        ],
        "latest_report": (
            {
                "report": latest_run.report,
                "system_name": latest_run.system.name,
                "created_at": iso(latest_run.completed_at),
                "run_id": latest_run.id,
            }
            if latest_run
            else None
        ),
        "ml_model": ml.model_to_dict(ml.latest_model(db)),
    }
