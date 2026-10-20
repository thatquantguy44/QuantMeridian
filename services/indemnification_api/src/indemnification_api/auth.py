"""Bearer-token boundary for the private INDEM service routes (same pattern as the other model
services).
"""

from __future__ import annotations

import hmac
import os
from uuid import UUID

from fastapi import Header, HTTPException, status


def production_allowed() -> bool:
    return (
        os.getenv("INDEM_ENV", "local").lower() != "production"
        or os.getenv("INDEM_PRODUCTION_ENABLED", "false").lower() == "true"
    )


def require_service_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> UUID:
    if not production_allowed():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "INDEM production is disabled")
    expected = os.getenv("INDEMNIFICATION_API_TOKEN")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "service token is not configured")
    prefix = "Bearer "
    supplied = (
        authorization[len(prefix) :] if authorization and authorization.startswith(prefix) else ""
    )
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service credential")
    try:
        return UUID(correlation_id or "")
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "X-Correlation-ID must be a UUID") from exc
