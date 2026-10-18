"""Structured logging for the macro ETL pipeline (Rich-backed)."""

from __future__ import annotations

import logging
from typing import Any

try:
    from rich.console import Console
    from rich.logging import RichHandler

    _RICH = True
except ImportError:  # pragma: no cover - rich is a declared dependency
    _RICH = False


_CONFIGURED = False


def get_console() -> Any:
    """Return a shared Rich console (or None if rich is unavailable)."""
    if _RICH:
        return Console(stderr=False)
    return None


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging once, using a Rich handler when available.

    Idempotent — repeated calls are no-ops so importing modules can call it
    freely without stacking handlers.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    numeric = getattr(logging, level.upper(), logging.INFO)

    if _RICH:
        handler: logging.Handler = RichHandler(
            console=Console(stderr=True),
            rich_tracebacks=True,
            show_time=True,
            show_path=False,
            markup=True,
        )
        fmt = "%(message)s"
    else:  # pragma: no cover
        handler = logging.StreamHandler()
        fmt = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

    logging.basicConfig(level=numeric, format=fmt, handlers=[handler], force=True)
    _CONFIGURED = True


def get_logger(name: str, level: str = "INFO") -> logging.LoggerAdapter:
    """Return a logger adapter bound to a pipeline context.

    The adapter carries run_id / source / stage in its `extra` dict so log lines
    can be correlated to a pipeline run. Unset fields render as ``-``.
    """
    configure_logging(level)
    base = logging.getLogger(name)
    return PipelineLoggerAdapter(base, {"run_id": "-", "source": "-", "stage": "-"})


class PipelineLoggerAdapter(logging.LoggerAdapter):
    """LoggerAdapter that prefixes messages with pipeline run context."""

    def process(self, msg: str, kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        ctx = self.extra or {}
        run_id = ctx.get("run_id", "-")
        source = ctx.get("source", "-")
        stage = ctx.get("stage", "-")
        prefix = f"[dim]\\[{run_id}·{source}·{stage}][/dim]" if _RICH else f"[{run_id}·{source}·{stage}]"
        return f"{prefix} {msg}", kwargs

    def bind(self, **ctx: Any) -> PipelineLoggerAdapter:
        """Return a new adapter with updated context fields."""
        merged = {**(self.extra or {}), **ctx}
        return PipelineLoggerAdapter(self.logger, merged)
