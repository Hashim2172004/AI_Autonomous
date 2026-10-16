from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

Category = Literal[
    "demand", "supply_chain", "operations", "workforce", "financial", "regulatory", "technology", "external", "opportunity"
]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SystemFields(BaseModel):
    name: Name
    industry: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=2000)]
    current_conditions: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    available_resources: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    constraints: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    assumptions: dict[str, Any] = Field(default_factory=dict)


class SystemUpdate(BaseModel):
    name: Name | None = None
    industry: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)] | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)] | None = None
    objective: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=2000)] | None = None
    current_conditions: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    available_resources: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    constraints: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    assumptions: dict[str, Any] | None = None


class GenerateRequest(SystemFields):
    system_id: int | None = None
    num_scenarios: int = Field(default=5, ge=1, le=20)
    auto_simulate: bool = True
    expand: bool = True
    use_knowledge: bool = True

    @field_validator("system_id", mode="before")
    @classmethod
    def _blank_system(cls, value: Any) -> Any:
        return None if value in ("", 0) else value


class ScenarioCreate(BaseModel):
    system_id: int
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
    category: Category = "operations"
    parameters: dict[str, float] = Field(default_factory=dict)


class ScenarioUpdate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)] | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)] | None = None
    category: Category | None = None
    parameters: dict[str, float] | None = None


class SimulateRequest(BaseModel):
    assumptions: dict[str, Any] = Field(default_factory=dict)


class WhatIfCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    parameters: dict[str, float] = Field(default_factory=dict)
    assumptions: dict[str, Any] = Field(default_factory=dict)


class DocumentCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=300)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=500_000)]
    source: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""
    system_id: int | None = None


class SearchRequest(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1000)]
    top_k: int = Field(default=5, ge=1, le=20)
    system_id: int | None = None
