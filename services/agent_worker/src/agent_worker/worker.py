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
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


@dataclass(frozen=True)
class WorkerConfig:
    queue_url: str
    api_url: str
    poll_seconds: float = 1.0
    worker_token: str = ""

    @property
    def postgres(self) -> bool:
        return self.queue_url.startswith(("postgres://", "postgresql://"))


def config_from_env() -> WorkerConfig:
    queue = os.environ.get("AGENT_QUEUE_DB_URL", "").strip()
    if not queue:
        raise RuntimeError("AGENT_QUEUE_NOT_CONFIGURED")
    return WorkerConfig(
        queue,
        os.environ.get("QUANTMERIDIAN_API_URL", "http://127.0.0.1:3000"),
        worker_token=os.environ.get("AGENT_WORKER_TOKEN", "").strip(),
    )


def _now() -> str:
    return datetime.now(UTC).isoformat()


class EcoIqWorker:
    """Claims queued ECOIQ jobs from the T-008 schema and runs them through the Node endpoint.

    Leases, fencing, heartbeats, and sweeps arrive with T-012; until then a claimed job is marked
    running with this worker's id and a lease deadline, and a failed call marks it WORKER_LOST.
    """

    LEASE_SECONDS = 60

    def __init__(self, config: WorkerConfig, worker_id: str | None = None):
        self.config = config
        self.worker_id = (
            worker_id or os.environ.get("AGENT_WORKER_ID") or f"worker-{uuid.uuid4().hex[:8]}"
        )
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

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.config.postgres else sql

    def _run(self, sql: str, params: tuple = ()) -> None:
        if self.config.postgres:
            with self._postgres_connection() as db:
                db.execute(self._sql(sql), params)
                db.commit()
        else:
            with sqlite3.connect(self.path) as db:
                db.execute(sql, params)
                db.commit()

    def _event(self, job_id: str, to_status: str, code: str | None = None) -> None:
        self._run(
            "INSERT INTO agent_job_event (id, job_id, at, from_status, to_status, actor, code) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()), job_id, _now(), "running", to_status,
                f"worker:{self.worker_id}", code,
            ),
        )

    def is_paused(self) -> bool:
        """Run-time kill switch (agent_control key 'paused'), checked on every poll."""
        query = "SELECT value FROM agent_control WHERE key = 'paused'"
        try:
            if self.config.postgres:
                with self._postgres_connection() as db:
                    row = db.execute(query).fetchone()
                    return bool(row and row["value"] == "1")
            with sqlite3.connect(self.path) as db:
                row = db.execute(query).fetchone()
                return bool(row and row[0] == "1")
        except (sqlite3.OperationalError, RuntimeError):
            return False
        except Exception as error:  # a missing agent_control table on Postgres
            if type(error).__name__ == "UndefinedTable":
                return False
            raise

    def _claim_updates(self, job_id: str) -> tuple[str, tuple]:
        now = datetime.now(UTC)
        lease = (now + timedelta(seconds=self.LEASE_SECONDS)).isoformat()
        return (
            "UPDATE agent_job SET status = 'running', attempt = attempt + 1, lease_owner = ?, "
            "lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ? "
            "WHERE id = ?",
            (self.worker_id, lease, now.isoformat(), now.isoformat(), job_id),
        )

    def claim_once(self) -> dict[str, object] | None:
        if self.is_paused():
            return None
        select = (
            "SELECT * FROM agent_job WHERE module = 'ECOIQ' AND status = 'queued' "
            "AND cancel_requested = 0 AND expires_at > ? ORDER BY created_at LIMIT 1"
        )
        if self.config.postgres:
            with self._postgres_connection() as db:
                with db.cursor() as cur:
                    locking = self._sql(select).replace("LIMIT 1", "FOR UPDATE SKIP LOCKED LIMIT 1")
                    cur.execute(locking, (_now(),))
                    row = cur.fetchone()
                    if row is None:
                        db.commit()
                        return None
                    sql, params = self._claim_updates(row["id"])
                    cur.execute(self._sql(sql), params)
                    db.commit()
                    job = dict(row)
        else:
            with sqlite3.connect(self.path) as db:
                db.row_factory = sqlite3.Row
                db.execute("BEGIN IMMEDIATE")
                row = db.execute(select, (_now(),)).fetchone()
                if row is None:
                    db.commit()
                    return None
                sql, params = self._claim_updates(row["id"])
                db.execute(sql, params)
                db.commit()
                job = dict(row)
        self._event(str(job["id"]), "running")
        return job

    def execute_once(self) -> bool:
        job = self.claim_once()
        if job is None:
            return False
        request = urllib.request.Request(
            f"{self.config.api_url}/api/agent/jobs/{job['id']}/execute",
            data=b"{}",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.config.worker_token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180):
                pass
        except Exception:
            now = _now()
            self._run(
                "UPDATE agent_job SET status = 'failed', error_code = 'WORKER_LOST', "
                "finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'",
                (now, now, job["id"]),
            )
            self._event(str(job["id"]), "failed", "WORKER_LOST")
        return True

    def run(self) -> None:
        while True:
            self.execute_once()
            time.sleep(self.config.poll_seconds)


if __name__ == "__main__":
    EcoIqWorker(config_from_env()).run()
