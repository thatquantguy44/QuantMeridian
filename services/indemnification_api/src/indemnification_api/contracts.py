"""Hashes for the INDEM wire contract (spec020). Must match src/lib/indemnificationContract.ts."""

from __future__ import annotations

from typing import Any

from .canonical import canonical_hash

_RECORD_ARRAYS = ("securities", "borrowers", "owners", "loans", "collateral")


def snapshot_hash(snapshot: dict[str, Any]) -> str:
    """SHA-256 of the canonical JSON of the snapshot without ``snapshot_hash``.

    Arrays of records are sorted by id (pool owner shares by owner_id), so record order never changes
    the hash.
    """
    body = {key: value for key, value in snapshot.items() if key != "snapshot_hash"}
    for name in _RECORD_ARRAYS:
        body[name] = sorted(body[name], key=lambda record: record["id"])
    pool = dict(body["pool"])
    pool["positions"] = sorted(pool["positions"], key=lambda record: record["id"])
    pool["owner_shares"] = sorted(pool["owner_shares"], key=lambda record: record["owner_id"])
    body["pool"] = pool
    return canonical_hash(body)


def profile_hash(profile: dict[str, Any]) -> str:
    """SHA-256 of the canonical JSON of a close-out profile, recorded on the model card."""
    return canonical_hash(profile)
