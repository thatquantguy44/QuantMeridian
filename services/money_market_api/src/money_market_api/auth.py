"""Bearer-token boundary for private QuantMeridian service routes."""

from __future__ import annotations

import hmac
import os
from uuid import UUID

from fastapi import Header, HTTPException, status


def _production_allowed() -> bool:
    return os.getenv("MMKT_ENV", "local").lower() != "production" or os.getenv(
        "MMKT_PRODUCTION_ENABLED", "false"
    ).lower() == "true"


def require_service_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> UUID:
    if not _production_allowed():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "MMKT production is disabled")
    expected = os.getenv("MONEY_MARKET_API_TOKEN")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "service token is not configured")
    prefix = "Bearer "
    supplied = ""
    if authorization and authorization.startswith(prefix):
        supplied = authorization[len(prefix) :]
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service credential")
    try:
        return UUID(correlation_id or "")
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "X-Correlation-ID must be a UUID"
        ) from exc
