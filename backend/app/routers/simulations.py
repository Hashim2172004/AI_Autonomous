from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from ..deps import CurrentUser, DbSession, not_found, paginate
from ..models import Simulation
from ..services.scenarios import simulation_to_dict

router = APIRouter(prefix="/simulations", tags=["simulations"])


@router.get("")
def list_simulations(
    db: DbSession,
    user: CurrentUser,
    scenario_id: int | None = None,
    status: str = "",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 15,
):
    stmt = select(Simulation).where(Simulation.user_id == user.id)
    if scenario_id:
        stmt = stmt.where(Simulation.scenario_id == scenario_id)
    if status:
        stmt = stmt.where(Simulation.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(joinedload(Simulation.scenario))
        .order_by(Simulation.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {"items": [simulation_to_dict(row, full=False) for row in rows], **paginate(total, page, page_size)}


@router.get("/{simulation_id}")
def get_simulation(simulation_id: int, db: DbSession, user: CurrentUser):
    simulation = db.get(Simulation, simulation_id)
    if simulation is None or simulation.user_id != user.id:
        raise not_found("Simulation")
    return simulation_to_dict(simulation)
