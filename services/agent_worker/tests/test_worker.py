import sqlite3
from pathlib import Path

from agent_worker.worker import EcoIqWorker, WorkerConfig

FUTURE = "2999-01-01T00:00:00+00:00"
SCHEMA = [
    "CREATE TABLE agent_job (id TEXT PRIMARY KEY, requester TEXT, module TEXT, workflow TEXT, "
    "status TEXT, attempt INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, started_at TEXT, "
    "finished_at TEXT, lease_owner TEXT, lease_expires_at TEXT, "
    "cancel_requested INTEGER DEFAULT 0, expires_at TEXT, error_code TEXT)",
    "CREATE TABLE agent_job_event (id TEXT, job_id TEXT, at TEXT, from_status TEXT, "
    "to_status TEXT, actor TEXT, code TEXT, detail_json TEXT)",
    "CREATE TABLE agent_control (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
]


def make_db(tmp_path: Path, jobs: list[tuple]) -> Path:
    path = tmp_path / "queue.db"
    with sqlite3.connect(path) as db:
        for statement in SCHEMA:
            db.execute(statement)
        for job in jobs:
            db.execute(
                "INSERT INTO agent_job (id, requester, module, workflow, status, created_at, "
                "cancel_requested, expires_at) "
                "VALUES (?, 'r1', ?, 'economics.explain', ?, ?, ?, ?)",
                job,
            )
        db.commit()
    return path


def worker_for(path: Path) -> EcoIqWorker:
    return EcoIqWorker(WorkerConfig(f"sqlite:{path}", "http://127.0.0.1:1"), worker_id="w-test")


def test_worker_accepts_postgres_queue_url() -> None:
    url = "postgresql://fred:fred@localhost:55432/macro_medallion"
    config = WorkerConfig(url, "http://localhost:3000")
    assert config.postgres is True


def test_worker_claims_only_queued_ecoiq(tmp_path: Path) -> None:
    path = make_db(
        tmp_path,
        [("j2", "OTHER", "queued", "0", 0, FUTURE), ("j1", "ECOIQ", "queued", "1", 0, FUTURE)],
    )
    worker = worker_for(path)
    assert worker.claim_once()["id"] == "j1"
    with sqlite3.connect(path) as db:
        row = db.execute(
            "SELECT status, attempt, lease_owner, started_at FROM agent_job WHERE id='j1'"
        ).fetchone()
        assert row[:3] == ("running", 1, "w-test") and row[3]
        events = db.execute("SELECT to_status, actor FROM agent_job_event").fetchall()
        assert events == [("running", "worker:w-test")]
    assert worker.claim_once() is None


def test_worker_skips_cancelled_and_expired_jobs(tmp_path: Path) -> None:
    path = make_db(
        tmp_path,
        [
            ("c1", "ECOIQ", "queued", "1", 1, FUTURE),
            ("e1", "ECOIQ", "queued", "2", 0, "2000-01-01T00:00:00+00:00"),
        ],
    )
    assert worker_for(path).claim_once() is None


def test_worker_does_not_claim_while_paused(tmp_path: Path) -> None:
    path = make_db(tmp_path, [("j1", "ECOIQ", "queued", "1", 0, FUTURE)])
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO agent_control VALUES ('paused', '1', '1')")
        db.commit()
    worker = worker_for(path)
    assert worker.claim_once() is None
    with sqlite3.connect(path) as db:
        db.execute("UPDATE agent_control SET value = '0'")
        db.commit()
    assert worker.claim_once()["id"] == "j1"


def test_failed_call_marks_worker_lost(tmp_path: Path) -> None:
    path = make_db(tmp_path, [("j1", "ECOIQ", "queued", "1", 0, FUTURE)])
    assert worker_for(path).execute_once() is True  # nothing listens on port 1
    with sqlite3.connect(path) as db:
        row = db.execute("SELECT status, error_code, finished_at FROM agent_job").fetchone()
        assert row[:2] == ("failed", "WORKER_LOST") and row[2]
        assert db.execute("SELECT to_status, code FROM agent_job_event").fetchall()[-1] == (
            "failed",
            "WORKER_LOST",
        )
