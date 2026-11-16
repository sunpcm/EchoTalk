"""Typed response contracts for infrastructure readiness."""

from typing import Literal

from pydantic import BaseModel


class SystemReadinessResponse(BaseModel):
    """Fixed success response after the shared database answers SELECT 1."""

    status: Literal["ready"]


class SystemReadinessUnavailableResponse(BaseModel):
    """Fixed failure response that never exposes underlying readiness errors."""

    status: Literal["not_ready"]
