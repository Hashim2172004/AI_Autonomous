from fastapi import APIRouter

from ..deps import CurrentUser, DbSession
from ..services import ml
from ..services.simulator import DEFAULT_ASSUMPTIONS, assumption_field_info

router = APIRouter(tags=["analysis"])


@router.get("/simulation/assumptions")
def assumptions(user: CurrentUser):
    return {
        "defaults": DEFAULT_ASSUMPTIONS,
        "fields": assumption_field_info(),
        "note": (
            "Values are in index units (baseline demand = 100) unless you set a unit price and currency. "
            "The same seed and inputs always reproduce the same results."
        ),
    }


@router.get("/ml/model")
def model_status(db: DbSession, user: CurrentUser):
    available, reason = ml.is_available()
    return {
        "available": available,
        "unavailable_reason": reason,
        "model": ml.model_to_dict(ml.latest_model(db)),
    }


@router.post("/ml/train")
def train_model(db: DbSession, user: CurrentUser):
    record = ml.train(db)
    return {"available": True, "unavailable_reason": None, "model": ml.model_to_dict(record)}
