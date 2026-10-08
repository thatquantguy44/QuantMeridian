#!/usr/bin/env node
// Run-time kill switch for agent workflows: `node scripts/agent-control.mjs pause|resume|status`.
// Uses AGENT_QUEUE_DB_URL (sqlite:<path> or a Postgres URL); job creation and worker claims
// check the flag on every request/poll.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const action = process.argv[2];
const url = (process.env.AGENT_QUEUE_DB_URL ?? "").trim();
if (!["pause", "resume", "status"].includes(action ?? "")) { console.error("usage: agent-control.mjs pause|resume|status"); process.exit(2); }
if (!url) { console.error("AGENT_QUEUE_NOT_CONFIGURED"); process.exit(2); }
const DDL = "CREATE TABLE IF NOT EXISTS agent_control (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)";
const stamp = new Date().toISOString();
const flag = action === "pause" ? "1" : "0";
let paused;
if (/^postgres(ql)?:\/\//i.test(url)) {
  const pg = require("pg"); const client = new pg.Client({ connectionString: url }); await client.connect();
  try {
    await client.query(DDL);
    if (action !== "status") await client.query("INSERT INTO agent_control (key, value, updated_at) VALUES ('paused', $1, $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2", [flag, stamp]);
    paused = (await client.query("SELECT value FROM agent_control WHERE key = 'paused'")).rows[0]?.value === "1";
  } finally { await client.end(); }
} else {
  const Database = require("better-sqlite3"); const db = new Database(url.replace(/^sqlite:/i, ""));
  try {
    db.exec(DDL);
    if (action !== "status") db.prepare("INSERT INTO agent_control (key, value, updated_at) VALUES ('paused', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(flag, stamp);
    paused = db.prepare("SELECT value FROM agent_control WHERE key = 'paused'").get()?.value === "1";
  } finally { db.close(); }
}
console.log(paused ? "agent workflows: PAUSED" : "agent workflows: running");
