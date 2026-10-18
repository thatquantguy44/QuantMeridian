"""Canonical JSON and SHA-256 hashing shared with the TypeScript client (spec012 SU-002).

The terminal hashes configurations in the browser and the service recomputes the same hash, so
both sides must produce byte-identical text. The rules follow JavaScript's `JSON.stringify` on a
value whose object keys are sorted: no whitespace, numbers in ECMAScript Number-to-String form,
non-ASCII characters left raw, and lone surrogates escaped. Non-finite numbers are rejected.
Values are never rounded (spec012 question 2).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        # Keys are the contract's ASCII field names, so code-point order equals JavaScript's
        # UTF-16 code-unit order.
        items = sorted(value.items())
        return "{" + ",".join(f"{_string(key)}:{canonical_json(item)}" for key, item in items) + "}"
    raise TypeError(f"cannot canonicalize {type(value).__name__}")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _string(text: str) -> str:
    encoded = json.dumps(text, ensure_ascii=False)
    return _LONE_SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", encoded)


def _number(x: float) -> str:
    """ECMAScript Number::toString for a finite double (ECMA-262 §6.1.6.1.20)."""
    if not math.isfinite(x):
        raise ValueError("non-finite numbers have no canonical JSON form")
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    # repr gives the shortest round-tripping digits, as JavaScript does; only the layout differs.
    mantissa, _, exponent = repr(abs(x)).partition("e")
    whole, _, fraction = mantissa.partition(".")
    raw = whole + fraction
    significant = raw.lstrip("0")
    n = len(whole) + int(exponent or 0) - (len(raw) - len(significant))
    digits = significant.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * -n + digits
    e = n - 1
    head = digits[0] + ("." + digits[1:] if k > 1 else "")
    return f"{sign}{head}e{'+' if e >= 0 else '-'}{abs(e)}"
