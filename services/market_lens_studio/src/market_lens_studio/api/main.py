"""FastAPI application for Market Lens Studio."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Market Lens Studio",
    description="Configurable market analytics framework inspired by Charlie Bilello-style analysis",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/market-lens")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "market-lens-studio"}
