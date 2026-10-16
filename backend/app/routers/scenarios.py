from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from ..deps import CurrentUser, DbSession, not_found, paginate, raise_validation
from ..models import Scenario, Simulation, System, WhatIf
from ..schemas import GenerateRequest, ScenarioCreate, ScenarioUpdate, SimulateRequest, WhatIfCreate
from ..services import ml
from ..services.generator import _changed_variables, generate_scenarios, validate_scenarios
from ..services.scenarios import (
    create_prediction,
    create_what_if,
    effective_assumptions,
    prediction_to_dict,
    run_simulation,
    save_generated,
    scenario_to_detail,
    scenario_to_summary,
    simulation_to_dict,
    system_to_dict,
    what_if_to_dict,
)
from ..services.simulator import ValidationError, normalise_assumptions, normalise_parameters, severity_for
from .systems import clean_overrides, get_owned_system

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

SORT_COLUMNS = {
    "created_at": Scenario.created_at,
    "title": func.lower(Scenario.title),
    "impact_score": Scenario.impact_score,
    "risk_score": Scenario.risk_score,
    "status": Scenario.status,
    "system_name": func.lower(System.name),
}


def get_owned_scenario(db, user_id: int, scenario_id: int) -> Scenario:
    scenario = db.get(Scenario, scenario_id)
    if scenario is None or scenario.user_id != user_id:
        raise not_found("Scenario")
    return scenario


def upsert_system(db, user_id: int, payload: GenerateRequest) -> System:
    """Use (and update) the chosen system, or create a new one from the form."""
    fields = payload.model_dump(
        include={"name", "industry", "description", "objective", "current_conditions", "available_resources", "constraints"}
    )
    overrides = clean_overrides(payload.assumptions)
    if payload.system_id:
        system = get_owned_system(db, user_id, payload.system_id)
        for key, value in fields.items():
            setattr(system, key, value)
        system.assumptions = overrides
    else:
        system = System(user_id=user_id, assumptions=overrides, **fields)
        db.add(system)
    db.commit()
    db.refresh(system)
    return system


@router.get("")
def list_scenarios(
    db: DbSession,
    user: CurrentUser,
    q: str = "",
    status_filter: Annotated[str, Query(alias="status")] = "",
    risk_level: str = "",
    category: str = "",
    system_id: int | None = None,
    sort_by: Literal["created_at", "title", "impact_score", "risk_score", "status", "system_name"] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 10,
):
    stmt = select(Scenario).join(System, Scenario.system_id == System.id).where(Scenario.user_id == user.id)
    if q.strip():
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Scenario.title).like(pattern),
                func.lower(Scenario.description).like(pattern),
                func.lower(System.name).like(pattern),
            )
        )
    if status_filter:
        stmt = stmt.where(Scenario.status == status_filter)
    if risk_level:
        stmt = stmt.where(Scenario.risk_level == risk_level)
    if category:
        stmt = stmt.where(Scenario.category == category)
    if system_id:
        stmt = stmt.where(Scenario.system_id == system_id)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    column = SORT_COLUMNS[sort_by]
    ordering = column.asc() if sort_order == "asc" else column.desc()
    if sort_by in ("impact_score", "risk_score"):
        ordering = ordering.nulls_last()
    stmt = (
        stmt.options(joinedload(Scenario.system))
        .order_by(ordering, Scenario.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = db.scalars(stmt).unique().all()
    return {"items": [scenario_to_summary(item) for item in items], **paginate(total, page, page_size)}


@router.post("/generate", status_code=status.HTTP_201_CREATED)
def generate(payload: GenerateRequest, db: DbSession, user: CurrentUser):
    system = upsert_system(db, user.id, payload)
    existing = db.scalars(select(Scenario.title).where(Scenario.system_id == system.id)).all()
    drafts = generate_scenarios(system_to_dict(system), payload.num_scenarios, set(existing), salt=f"rules{len(existing)}")
    start = len(existing) + 1
    for offset, draft in enumerate(drafts):
        draft["scenario_key"] = f"S{start + offset}"
    kept, _report = validate_scenarios(drafts, system_to_dict(system))
    saved = save_generated(db, user.id, system, kept, source="rules")
    db.commit()

    simulated = failures = 0
    if payload.auto_simulate:
        for scenario in saved:
            result = run_simulation(db, scenario, user.id)
            if result.status == "completed":
                simulated += 1
            else:
                failures += 1
    return {
        "system": system_to_dict(system),
        "scenarios": [scenario_to_summary(s) for s in saved],
        "simulated": simulated,
        "simulation_failures": failures,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_scenario(payload: ScenarioCreate, db: DbSession, user: CurrentUser):
    system = get_owned_system(db, user.id, payload.system_id)
    try:
        params = normalise_parameters(payload.parameters)
    except ValidationError as error:
        raise_validation(error, "parameters")
    severity, _ = severity_for(params)
    scenario = Scenario(
        user_id=user.id,
        system_id=system.id,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        severity=severity,
        source="manual",
        parameters=params,
        details={"kind": "base", "changed_variables": _changed_variables(params, effective_assumptions(system))},
        assumptions=[],
    )
    db.add(scenario)
    db.commit()
    return scenario_to_detail(db, scenario)


@router.get("/{scenario_id}")
def get_scenario(scenario_id: int, db: DbSession, user: CurrentUser):
    return scenario_to_detail(db, get_owned_scenario(db, user.id, scenario_id))


@router.patch("/{scenario_id}")
def update_scenario(scenario_id: int, payload: ScenarioUpdate, db: DbSession, user: CurrentUser):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "parameters" in changes:
        try:
            params = normalise_parameters(changes.pop("parameters"), base=scenario.parameters)
        except ValidationError as error:
            raise_validation(error, "parameters")
        scenario.parameters = params
        scenario.severity = severity_for(params)[0]
        details = dict(scenario.details or {})
        details["changed_variables"] = _changed_variables(params, effective_assumptions(scenario.system))
        scenario.details = details
    for key, value in changes.items():
        setattr(scenario, key, value)
    db.commit()
    return scenario_to_detail(db, scenario)


@router.delete("/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(scenario_id: int, db: DbSession, user: CurrentUser) -> Response:
    scenario = get_owned_scenario(db, user.id, scenario_id)
    db.delete(scenario)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{scenario_id}/simulate")
def simulate_scenario(
    scenario_id: int, db: DbSession, user: CurrentUser, payload: SimulateRequest | None = None
):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    overrides = payload.assumptions if payload else None
    if overrides:
        try:
            normalise_assumptions(overrides, base=scenario.system.assumptions)
        except ValidationError as error:
            raise_validation(error, "assumptions")
    simulation = run_simulation(db, scenario, user.id, overrides)
    if simulation.status != "completed":
        raise HTTPException(500, f"The simulation failed: {simulation.error}")
    return simulation_to_dict(simulation)


@router.get("/{scenario_id}/simulations")
def scenario_simulations(scenario_id: int, db: DbSession, user: CurrentUser):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    rows = db.scalars(
        select(Simulation).where(Simulation.scenario_id == scenario.id).order_by(Simulation.id.desc())
    ).all()
    return [simulation_to_dict(row, full=False) for row in rows]


@router.post("/{scenario_id}/predict")
def predict_scenario(scenario_id: int, db: DbSession, user: CurrentUser):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    available, reason = ml.is_available()
    if not available:
        raise HTTPException(503, f"ML prediction is unavailable: {reason}")
    return prediction_to_dict(create_prediction(db, scenario))


@router.get("/{scenario_id}/what-if")
def list_what_ifs(scenario_id: int, db: DbSession, user: CurrentUser):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    rows = db.scalars(select(WhatIf).where(WhatIf.scenario_id == scenario.id).order_by(WhatIf.id.desc())).all()
    return [what_if_to_dict(row) for row in rows]


@router.post("/{scenario_id}/what-if", status_code=status.HTTP_201_CREATED)
def create_what_if_analysis(scenario_id: int, payload: WhatIfCreate, db: DbSession, user: CurrentUser):
    scenario = get_owned_scenario(db, user.id, scenario_id)
    if not payload.parameters and not payload.assumptions:
        raise HTTPException(422, "Change at least one parameter or assumption.")
    try:
        normalise_parameters(payload.parameters, base=scenario.parameters)
        normalise_assumptions(payload.assumptions, base=scenario.system.assumptions)
    except ValidationError as error:
        raise_validation(error, "parameters" if set(error.fields) & set(payload.parameters) else "assumptions")
    try:
        what_if = create_what_if(db, scenario, user.id, payload.name, payload.parameters, payload.assumptions)
    except RuntimeError as error:
        raise HTTPException(500, str(error)) from error
    return what_if_to_dict(what_if)
