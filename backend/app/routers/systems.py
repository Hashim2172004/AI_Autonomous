from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select

from ..deps import CurrentUser, DbSession, not_found, raise_validation
from ..models import Scenario, System
from ..schemas import SystemFields, SystemUpdate
from ..services.scenarios import system_to_dict
from ..services.simulator import ValidationError, normalise_assumptions

router = APIRouter(prefix="/systems", tags=["systems"])


def clean_overrides(values: dict[str, Any] | None) -> dict[str, Any]:
    """Validate user-supplied assumption overrides and keep only the keys that were set."""
    values = {k: v for k, v in (values or {}).items() if v not in ("", None)}
    if not values:
        return {}
    try:
        full = normalise_assumptions(values)
    except ValidationError as error:
        raise_validation(error, "assumptions")
    return {key: full[key] for key in values}


def get_owned_system(db, user_id: int, system_id: int) -> System:
    system = db.get(System, system_id)
    if system is None or system.user_id != user_id:
        raise not_found("System")
    return system


def scenario_counts(db, user_id: int) -> dict[int, int]:
    rows = db.execute(
        select(Scenario.system_id, func.count(Scenario.id)).where(Scenario.user_id == user_id).group_by(Scenario.system_id)
    ).all()
    return {system_id: count for system_id, count in rows}


@router.get("")
def list_systems(db: DbSession, user: CurrentUser):
    systems = db.scalars(select(System).where(System.user_id == user.id).order_by(System.name)).all()
    counts = scenario_counts(db, user.id)
    return [system_to_dict(system, counts.get(system.id, 0)) for system in systems]


@router.get("/{system_id}")
def get_system(system_id: int, db: DbSession, user: CurrentUser):
    system = get_owned_system(db, user.id, system_id)
    return system_to_dict(system, scenario_counts(db, user.id).get(system.id, 0))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_system(payload: SystemFields, db: DbSession, user: CurrentUser):
    data = payload.model_dump()
    data["assumptions"] = clean_overrides(data["assumptions"])
    system = System(user_id=user.id, **data)
    db.add(system)
    db.commit()
    db.refresh(system)
    return system_to_dict(system, 0)


@router.patch("/{system_id}")
def update_system(system_id: int, payload: SystemUpdate, db: DbSession, user: CurrentUser):
    system = get_owned_system(db, user.id, system_id)
    changes = payload.model_dump(exclude_unset=True)
    if "assumptions" in changes:
        changes["assumptions"] = clean_overrides(changes["assumptions"])
    for key, value in changes.items():
        if value is None and key in ("name", "industry", "description", "objective"):
            raise HTTPException(422, f"{key} cannot be empty")
        setattr(system, key, value if value is not None else "")
    db.commit()
    db.refresh(system)
    return system_to_dict(system, scenario_counts(db, user.id).get(system.id, 0))


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_system(system_id: int, db: DbSession, user: CurrentUser) -> Response:
    system = get_owned_system(db, user.id, system_id)
    db.delete(system)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
