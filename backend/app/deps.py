from typing import Annotated, Any, NoReturn

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_access_token
from .services.simulator import ValidationError

DbSession = Annotated[Session, Depends(get_db)]
_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    unauthorised = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorised
    user_id = decode_access_token(credentials.credentials)
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise unauthorised
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def raise_validation(error: ValidationError, section: str) -> NoReturn:
    """Turn a simulator validation error into a FastAPI-style 422 the frontend maps to fields."""
    raise HTTPException(
        status_code=422,
        detail=[
            {"loc": ["body", section, field], "msg": message, "type": "value_error"}
            for field, message in error.fields.items()
        ],
    )


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


def paginate(total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}
