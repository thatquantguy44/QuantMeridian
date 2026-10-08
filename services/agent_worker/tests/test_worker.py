import sqlite3
from pathlib import Path

from agent_worker.worker import EcoIqWorker, WorkerConfig


def test_worker_accepts_postgres_queue_url() -> None:
    config = WorkerConfig("postgresql://fred:fred@localhost:55432/macro_medallion", "http://localhost:3000")
    assert config.postgres is True


def test_worker_claims_only_queued_ecoiq(tmp_path: Path) -> None:
    db_path = tmp_path / "queue.db"
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE agent_job (job_id TEXT, requester_id TEXT, module TEXT, workflow TEXT, status TEXT, attempts INTEGER, created_at TEXT, updated_at TEXT, message TEXT, context_json TEXT, profile TEXT, error_code TEXT, result_json TEXT)")
        db.execute("INSERT INTO agent_job VALUES ('j1','r1','ECOIQ','economics.explain','queued',0,'1','1','why','{}','deterministic',NULL,NULL)")
        db.execute("INSERT INTO agent_job VALUES ('j2','r1','OTHER','analysis.answer','queued',0,'0','0','x','{}',NULL,NULL,NULL)")
        db.commit()
    worker = EcoIqWorker(WorkerConfig(f"sqlite:{db_path}", "http://127.0.0.1:1"))
    assert worker.claim_once()["job_id"] == "j1"
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT status FROM agent_job WHERE job_id='j1'").fetchone()[0] == "running"
