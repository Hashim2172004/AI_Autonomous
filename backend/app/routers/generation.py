from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from ..deps import CurrentUser, DbSession, not_found, paginate
from ..models import GenerationRun, KnowledgeDocument, Scenario, ScenarioRelationship, iso
from ..schemas import GenerateRequest
from ..services import agent, llm
from ..services.scenarios import scenario_to_run_row
from .scenarios import upsert_system

router = APIRouter(prefix="/generation", tags=["generation"])


def run_to_dict(run: GenerationRun) -> dict:
    return {
        "id": run.id,
        "system_id": run.system_id,
        "system_name": run.system.name if run.system else None,
        "status": run.status,
        "requested_count": run.requested_count,
        "options": run.options,
        "steps": run.steps,
        "events": run.events,
        "stats": run.stats,
        "validation_report": run.validation_report,
        "system_analysis": run.system_analysis,
        "retrieved_knowledge": run.retrieved_knowledge or [],
        "report": run.report,
        "error": run.error,
        "created_at": iso(run.created_at),
        "completed_at": iso(run.completed_at),
    }


@router.get("/config")
def config(db: DbSession, user: CurrentUser):
    documents = db.scalar(select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.user_id == user.id)) or 0
    provider, model = agent.provider_info()
    return {
        "llm_configured": llm.is_configured(),
        "llm_provider": provider,
        "llm_model": model,
        "llm_hint": (
            "No Anthropic API key is configured (set ANTHROPIC_API_KEY in backend/.env and restart the API). "
            "The agent still runs end to end with its built-in rule engine "
            "(templates, validation, combinations, simulation, ML prediction and a template report)."
        ),
        "knowledge_documents": documents,
        "embedding_model": "TF-IDF keyword similarity",
        "embedding_runtime": "scikit-learn, runs locally",
        "embedding_note": "matches shared vocabulary rather than meaning, so use the same terms as your documents",
        "embedding_warning": None,
    }


@router.post("/runs", status_code=status.HTTP_201_CREATED)
def start_run(payload: GenerateRequest, db: DbSession, user: CurrentUser):
    system = upsert_system(db, user.id, payload)
    provider, model = agent.provider_info()
    run = GenerationRun(
        user_id=user.id,
        system_id=system.id,
        status="queued",
        requested_count=payload.num_scenarios,
        options={
            "llm_provider": provider,
            "llm_model": model,
            "use_knowledge": payload.use_knowledge,
            "expand": payload.expand,
            "num_scenarios": payload.num_scenarios,
        },
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run.system = system
    agent.start_run(run.id)
    return run_to_dict(run)


@router.get("/runs")
def list_runs(
    db: DbSession,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    stmt = select(GenerationRun).where(GenerationRun.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(GenerationRun.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [run_to_dict(row) for row in rows], **paginate(total, page, page_size)}


def _owned_run(db, user_id: int, run_id: int) -> GenerationRun:
    run = db.get(GenerationRun, run_id)
    if run is None or run.user_id != user_id:
        raise not_found("Generation run")
    return run


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: DbSession, user: CurrentUser):
    return run_to_dict(_owned_run(db, user.id, run_id))


@router.get("/runs/{run_id}/scenarios")
def run_scenarios(run_id: int, db: DbSession, user: CurrentUser):
    run = _owned_run(db, user.id, run_id)
    scenarios = db.scalars(select(Scenario).where(Scenario.run_id == run.id)).all()
    scenarios.sort(key=lambda s: (s.rank is None, s.rank if s.rank is not None else 0, s.id))
    relationships = db.scalars(select(ScenarioRelationship).where(ScenarioRelationship.run_id == run.id)).all()
    return {
        "scenarios": [scenario_to_run_row(s) for s in scenarios],
        "relationships": [
            {"id": r.id, "source_scenario_id": r.source_scenario_id, "target_scenario_id": r.target_scenario_id}
            for r in relationships
        ],
    }
