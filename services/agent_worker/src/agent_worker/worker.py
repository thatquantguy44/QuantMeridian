"""Small local ECOIQ queue worker.

The worker is intentionally conservative: it claims only ECOIQ jobs, sends the
question to the QuantMeridian attended execution endpoint, and records heartbeat
metadata. Production deployment still requires the Spec 009 gate and token.
"""

from __future__ import annotations

import os
import sqlite3
import time
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True)
class WorkerConfig:
    queue_url: str
    api_url: str
    poll_seconds: float = 1.0

    @property
    def postgres(self) -> bool:
        return self.queue_url.startswith(("postgres://", "postgresql://"))


def config_from_env() -> WorkerConfig:
    queue = os.environ.get("AGENT_QUEUE_DB_URL", "").strip()
    if not queue:
        raise RuntimeError("AGENT_QUEUE_NOT_CONFIGURED")
    return WorkerConfig(queue, os.environ.get("QUANTMERIDIAN_API_URL", "http://127.0.0.1:3000"))


def _now() -> str:
    return datetime.now(UTC).isoformat()


class EcoIqWorker:
    _LOST = (
        "UPDATE agent_job SET status = 'failed', error_code = 'WORKER_LOST', "
        "updated_at = {} WHERE job_id = {}"
    )
    _LOST_PG = _LOST.format("%s", "%s")
    _LOST_SQLITE = _LOST.format("?", "?")

    def __init__(self, config: WorkerConfig):
        self.config = config
        if not config.postgres and not config.queue_url.startswith("sqlite:"):
            raise RuntimeError("AGENT_QUEUE_URL_UNSUPPORTED")
        self.path = config.queue_url.removeprefix("sqlite:")

    def _postgres_connection(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise RuntimeError("psycopg is required for a PostgreSQL agent queue") from error
        return psycopg.connect(self.config.queue_url, row_factory=dict_row)

    def claim_once(self) -> dict[str, object] | None:
        if self.config.postgres:
            with self._postgres_connection() as db:
                with db.cursor() as cur:
                    cur.execute("""
                        SELECT * FROM agent_job
                        WHERE module = 'ECOIQ' AND status = 'queued'
                        ORDER BY created_at
                        FOR UPDATE SKIP LOCKED LIMIT 1
                    """)
                    row = cur.fetchone()
                    if row is None:
                        db.commit()
                        return None
                    cur.execute(
                        "UPDATE agent_job SET status = 'running', attempts = attempts + 1, "
                        "updated_at = %s WHERE job_id = %s",
                        (_now(), row["job_id"]),
                    )
                    db.commit()
                    return dict(row)
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM agent_job WHERE module = 'ECOIQ' AND status = 'queued' "
                "ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                db.commit()
                return None
            db.execute(
                "UPDATE agent_job SET status = 'running', attempts = attempts + 1, "
                "updated_at = ? WHERE job_id = ?",
                (_now(), row["job_id"]),
            )
            db.commit()
            return dict(row)

    def execute_once(self) -> bool:
        job = self.claim_once()
        if job is None:
            return False
        request = urllib.request.Request(
            f"{self.config.api_url}/api/agent/jobs/{job['job_id']}/execute",
            data=b"{}",
            headers={
                "content-type": "application/json",
                "cookie": f"agent_sid={job['requester_id']}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180):
                pass
        except Exception:
            if self.config.postgres:
                with self._postgres_connection() as db:
                    db.execute(self._LOST_PG, (_now(), job["job_id"]))
                    db.commit()
            else:
                with sqlite3.connect(self.path) as db:
                    db.execute(self._LOST_SQLITE, (_now(), job["job_id"]))
                    db.commit()
        return True

    def run(self) -> None:
        while True:
            self.execute_once()
            time.sleep(self.config.poll_seconds)


if __name__ == "__main__":
    EcoIqWorker(config_from_env()).run()
