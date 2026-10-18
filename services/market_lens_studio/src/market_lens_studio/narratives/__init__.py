"""Narrative text generation and caveat library."""

from .caveats import get_applicable_caveats
from .generator import generate_narrative

__all__ = ["generate_narrative", "get_applicable_caveats"]
