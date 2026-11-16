"""Response contract for deleting the authenticated user's account."""

from typing import Literal

from pydantic import BaseModel


class UserAccountDeletionResponse(BaseModel):
    """Fixed acknowledgement returned only after account deletion commits."""

    status: Literal["deleted"]
