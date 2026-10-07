/**
 * Incremental FRED master JSON exporter.
 *
 * Writes one raw `lin` JSON file per redistributable FRED catalog series under
 * `data/master/fred/`, plus `data/master/manifest.json` and a run report. Each
 * run preserves existing observations, fetches only the missing/revision overlap
 * window, and never deletes existing master data when a provider request fails.
 *
 * Run with:
 *   FRED_API_KEY=xxxx npm run refresh:fred-master
 */
import fs from "node:fs";
import path from "node:path";
import { FRED_CATALOG, resolveFred, type FredSeries } from "@/data/econSeries";
import {
  MASTER_JSON_SCHEMA_VERSION,
  type MasterAssetClass,
  type MasterFrequency,
  type MasterManifestEntry,
  type MasterManifestFile,
  type MasterRefreshFailure,
  type MasterRefreshReport,
  type MasterSeriesFile,
  type MasterValueObservation,
} from "@/data/masterJson";
import { ensureProxy, fetchWithProxyFallback } from "@/lib/server/fetchProxy";

const ROOT = path.resolve(process.cwd(), "data/master");
const FRED_DIR = path.join(ROOT, "fred");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const REPORT_DIR = path.join(ROOT, "reports");
const FULL_HISTORY_START = process.env.FRED_MASTER_START_DATE || "1900-01-01";

// The shared FRED client was removed in the Gold DB migration; this offline
// exporter keeps its own minimal observations fetch (raw `lin` levels only).
const FRED_BASE = (process.env.FRED_BASE_URL || "https://api.stlouisfed.org/fred").trim().replace(/\/$/, "");

function fredEnabled(): boolean {
  return Boolean(process.env.FRED_API_KEY);
}

async function fredSeries(seriesId: string, start: string): Promise<{ date: string; value: number | null }[]> {
  const qs = new URLSearchParams({
    series_id: seriesId,
    sort_order: "asc",
    observation_start: start,
    api_key: process.env.FRED_API_KEY ?? "",
    file_type: "json",
  });
  const res = await fetchWithProxyFallback(`${FRED_BASE}/series/observations?${qs}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`FRED ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { observations: { date: string; value: string }[] };
  return json.observations.map((o) => ({ date: o.date, value: o.value === "." ? null : Number(o.value) }));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function overlapStart(lastObservationDate: string | null, frequency: MasterFrequency): string {
  if (!lastObservationDate) return FULL_HISTORY_START;
  if (frequency === "M" || frequency === "Q" || frequency === "A") return addDays(lastObservationDate, -548);
  return addDays(lastObservationDate, -10);
}

function categoryToAssetClass(category: FredSeries["category"]): MasterAssetClass {
  if (category === "RATES") return "RATE";
  if (category === "CREDIT") return "CREDIT";
  if (category === "FX") return "FX";
  return "MACRO";
}

function frequencyOf(s: FredSeries): MasterFrequency {
  return s.freq;
}

function seriesPath(id: string): string {
  return path.join(FRED_DIR, `${id}.json`);
}

function cleanObservation(obs: { date: string; value: number | null }): MasterValueObservation | null {
  if (obs.value == null || !Number.isFinite(obs.value)) return null;
  return { date: obs.date, value: obs.value };
}

function mergeObservations(existing: MasterValueObservation[], next: MasterValueObservation[]): MasterValueObservation[] {
  const byDate = new Map<string, MasterValueObservation>();
  for (const obs of existing) byDate.set(obs.date, obs);
  for (const obs of next) byDate.set(obs.date, obs);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildSeriesFile(
  s: FredSeries,
  existing: MasterSeriesFile<MasterValueObservation> | null,
  observations: MasterValueObservation[],
  generatedAt: string
): MasterSeriesFile<MasterValueObservation> {
  const merged = mergeObservations(existing?.observations ?? [], observations);
  return {
    schemaVersion: MASTER_JSON_SCHEMA_VERSION,
    provider: "FRED",
    symbol: s.id,
    sourceId: s.id,
    assetClass: categoryToAssetClass(s.category),
    frequency: frequencyOf(s),
    currency: null,
    units: "lin",
    generatedAt,
    firstObservationDate: merged[0]?.date ?? null,
    lastObservationDate: merged[merged.length - 1]?.date ?? null,
    observations: merged,
    metadata: {
      displayName: s.label,
      providerUrl: `https://fred.stlouisfed.org/series/${encodeURIComponent(s.id)}`,
      licenseTier: "redistributable-public",
      transformPolicy: "store_raw_derive_display",
      notes: [`Terminal display unit: ${s.unit}`],
    },
  };
}

function manifestEntry(file: MasterSeriesFile, filePath: string): MasterManifestEntry {
  return {
    provider: file.provider,
    symbol: file.symbol,
    path: path.relative(process.cwd(), filePath),
    assetClass: file.assetClass,
    frequency: file.frequency,
    firstObservationDate: file.firstObservationDate,
    lastObservationDate: file.lastObservationDate,
    generatedAt: file.generatedAt,
    observations: file.observations.length,
    licenseTier: file.metadata.licenseTier,
  };
}

async function main(): Promise<void> {
  if (!fredEnabled()) {
    console.error("FRED_API_KEY not set — cannot refresh the FRED master cache.");
    process.exit(1);
  }
  await ensureProxy();
  ensureDir(FRED_DIR);
  ensureDir(REPORT_DIR);

  const startedAt = new Date().toISOString();
  const failures: MasterRefreshFailure[] = [];
  const entries: MasterManifestEntry[] = [];
  let written = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const s of FRED_CATALOG) {
    const resolved = resolveFred(s.id);
    if (resolved.simOnly) {
      skipped++;
      continue;
    }

    const out = seriesPath(s.id);
    const existing = readJson<MasterSeriesFile<MasterValueObservation>>(out);
    const start = overlapStart(existing?.lastObservationDate ?? null, frequencyOf(s));

    try {
      const live = await fredSeries(s.id, start);
      const clean = live.map(cleanObservation).filter((o): o is MasterValueObservation => o !== null);
      if (!clean.length && !existing) {
        failures.push({ id: s.id, reason: "No observations returned" });
        continue;
      }

      const next = buildSeriesFile(s, existing, clean, new Date().toISOString());
      const beforeLast = existing?.lastObservationDate ?? null;
      const beforeCount = existing?.observations.length ?? 0;
      atomicWriteJson(out, next);
      entries.push(manifestEntry(next, out));

      if (!existing) written++;
      else if (next.lastObservationDate !== beforeLast || next.observations.length !== beforeCount) updated++;
      else unchanged++;
    } catch (err) {
      failures.push({ id: s.id, reason: (err as Error).message });
      if (existing) entries.push(manifestEntry(existing, out));
    }
  }

  const generatedAt = new Date().toISOString();
  const manifest: MasterManifestFile = {
    schemaVersion: MASTER_JSON_SCHEMA_VERSION,
    generatedAt,
    entries: entries.sort((a, b) => `${a.provider}:${a.symbol}`.localeCompare(`${b.provider}:${b.symbol}`)),
  };
  atomicWriteJson(MANIFEST_PATH, manifest);

  const report: MasterRefreshReport = {
    provider: "FRED",
    startedAt,
    finishedAt: generatedAt,
    written,
    updated,
    unchanged,
    skipped,
    failed: failures,
  };
  atomicWriteJson(path.join(REPORT_DIR, `fred-${generatedAt.replace(/[:.]/g, "-")}.json`), report);

  console.log(
    `fred master → ${FRED_DIR}: ${written} written, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped, ${failures.length} failed.`
  );
}

void main();

