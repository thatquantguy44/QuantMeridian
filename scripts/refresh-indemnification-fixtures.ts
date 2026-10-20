// Recomputes every hash in the INDEM contract fixtures (spec020) after a contract or fixture change, then
// re-exports the simulated book. Idempotent: running it on current files changes nothing.
//   npx vite-node scripts/refresh-indemnification-fixtures.ts
// The tests in src/lib/indemnificationContract.test.ts, src/data/indemnificationBook.test.ts and
// services/indemnification_api/tests/test_contracts.py fail if any of these files is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { buildSimSnapshot } from "../src/data/indemnificationBook";
import { profileHash, snapshotHash } from "../src/lib/indemnificationContract";

const dir = new URL("../contracts/indemnification/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf-8"));
const write = (name: string, value: unknown) => writeFileSync(new URL(name, dir), JSON.stringify(value, null, 2) + "\n");

const snapshot = read("fixtures/snapshot.example.json");
snapshot.snapshot_hash = await snapshotHash(snapshot);
write("fixtures/snapshot.example.json", snapshot);

const defaultProfileHash = await profileHash(read("closeout-profile.default.json"));
const fixtureProfileHash = await profileHash(snapshot.closeout_profile);
write("fixtures/hash-vectors.json", {
  ...read("fixtures/hash-vectors.json"),
  snapshot: { file: "snapshot.example.json", hash: snapshot.snapshot_hash },
  profiles: [
    { file: "../closeout-profile.default.json", hash: defaultProfileHash },
    { embedded_in: "snapshot.example.json", hash: fixtureProfileHash },
  ],
});

const result = read("fixtures/result.example.json");
result.snapshot_hash = snapshot.snapshot_hash;
result.model_card.snapshot_hash = snapshot.snapshot_hash;
result.model_card.profile_hash = fixtureProfileHash;
write("fixtures/result.example.json", result);

const book = await buildSimSnapshot({ asOf: "2026-10-20", run: { paths: 5000, preview: true } });
write("fixtures/sim-book.example.json", book);

console.log("snapshot", snapshot.snapshot_hash);
console.log("sim book", book.snapshot_hash);
