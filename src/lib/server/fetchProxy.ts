/**
 * Optional outbound-proxy support for the server's `fetch` calls (FRED, the
 * market pipeline, news services, …).
 *
 * Node's global `fetch` (undici) ignores the `HTTP(S)_PROXY` environment
 * variables that browsers/curl honour, so on a corporate network the browser
 * can reach an API while the app's `fetch` fails. When a proxy URL is
 * resolved we install an undici `ProxyAgent` as the global dispatcher, which
 * routes every server-side `fetch` through it. With nothing configured this is
 * a no-op and fetch behaves exactly as before.
 *
 * Resolution order (first match wins):
 *   1. Environment: FRED_PROXY_URL, then HTTPS_PROXY / HTTP_PROXY (any casing).
 *   2. A project-root file: PROXY_ENV_FILE (if set), else `.proxy`, else `.env`.
 *      The file uses `KEY=value` lines (dotenv-style); the same proxy keys are
 *      read from it. This covers runtimes where env vars aren't injected (e.g.
 *      `npm start`, where Vite's `.env` loader doesn't run).
 *
 * Server-only (loaded from the route registry / server entries, never the
 * client bundle), so the `undici` import is dynamic and externalised.
 */
import fs from "node:fs";
import path from "node:path";

let setup: Promise<void> | null = null;
let proxyAgent: unknown | null = null;
let proxyAgentUrl: string | null = null;
let directAgent: unknown | null = null;

const PROXY_KEYS = ["FRED_PROXY_URL", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;
const PROXY_FALLBACK_STATUSES = new Set([403, 407, 429, 502, 503, 504]);

function validProxyUrl(value: string, source: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("proxy URL must use http or https");
    return value;
  } catch (err) {
    console.warn(`[proxy] ignoring invalid proxy ${value} (from ${source}): ${(err as Error).message}`);
    return undefined;
  }
}

function fromEnv(): string | undefined {
  for (const key of PROXY_KEYS) {
    const value = process.env[key];
    if (value) {
      const valid = validProxyUrl(value, `environment ${key}`);
      if (valid) return valid;
    }
  }
  return undefined;
}

/** Parse a dotenv-style file into a flat map (ignores comments/blank lines). */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2"); // strip surrounding quotes
  }
  return out;
}

/** Fallback: read a proxy URL from a project-root config file. */
function fromFile(): { url: string; file: string } | undefined {
  const candidates = [process.env.PROXY_ENV_FILE, ".proxy", ".env"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const file = path.resolve(process.cwd(), candidate);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // file not present — try the next candidate
    }
    const vars = parseEnvFile(text);
    for (const key of PROXY_KEYS) {
      if (vars[key]) {
        const valid = validProxyUrl(vars[key], `file ${candidate}`);
        if (valid) return { url: valid, file: candidate };
      }
    }
  }
  return undefined;
}

const LOOPBACK_BYPASS = ["localhost", "127.0.0.1", "::1"];

/** NO_PROXY from the environment, always extended with loopback hosts. */
export function noProxyList(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set([...configured, ...LOOPBACK_BYPASS])].join(",");
}

function proxyMatch(): { url: string; source: string } | undefined {
  const envUrl = fromEnv();
  if (envUrl) return { url: envUrl, source: "environment" };
  const fileMatch = fromFile();
  if (fileMatch) return { url: fileMatch.url, source: `file ${fileMatch.file}` };
  return undefined;
}

/**
 * Install the proxy dispatcher once (memoised). Safe to await on every request.
 * Logs which mode is active so it's visible in the dev/server terminal.
 */
export function ensureProxy(): Promise<void> {
  if (setup) return setup;
  setup = (async () => {
    const match = proxyMatch();
    if (!match) {
      console.log("[proxy] no proxy configured (env vars or .proxy/.env file) — server fetch goes direct");
      return;
    }
    try {
      const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
      // Honour NO_PROXY so loopback and internal model services (MMKT on 127.0.0.1:8014,
      // IBAL, …) are reached directly instead of through an outbound proxy.
      setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: match.url, httpsProxy: match.url, noProxy: noProxyList() }));
      console.log(`[proxy] server fetch routed through ${match.url} (from ${match.source}); bypass: ${noProxyList()}`);
    } catch (err) {
      console.warn(`[proxy] failed to enable proxy ${match.url} (from ${match.source}): ${(err as Error).message}`);
    }
  })();
  return setup;
}

async function getProxyDispatcher(url: string): Promise<unknown> {
  if (!proxyAgent || proxyAgentUrl !== url) {
    const { ProxyAgent } = await import("undici");
    proxyAgent = new ProxyAgent(url);
    proxyAgentUrl = url;
  }
  return proxyAgent;
}

async function getDirectDispatcher(): Promise<unknown> {
  if (!directAgent) {
    const { Agent } = await import("undici");
    directAgent = new Agent();
  }
  return directAgent;
}

function withDispatcher(init: RequestInit | undefined, dispatcher: unknown): RequestInit {
  return { ...(init ?? {}), dispatcher } as RequestInit;
}

/**
 * Fetch with a two-step proxy fallback for server-side provider calls.
 *
 * If a proxy is configured, try the proxy path first. On proxy construction
 * errors, network failures, or common proxy/block statuses, retry the same
 * request direct. With no configured proxy, this is just a direct fetch.
 */
export async function fetchWithProxyFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const match = proxyMatch();
  if (!match) return fetch(input, init);

  let proxyResponse: Response | null = null;
  try {
    const dispatcher = await getProxyDispatcher(match.url);
    proxyResponse = await fetch(input, withDispatcher(init, dispatcher));
    if (!PROXY_FALLBACK_STATUSES.has(proxyResponse.status)) return proxyResponse;
    console.warn(`[proxy] ${proxyResponse.status} via ${match.source}; retrying provider request direct`);
  } catch (err) {
    console.warn(`[proxy] provider request failed via ${match.source}; retrying direct: ${(err as Error).message}`);
  }

  try {
    const dispatcher = await getDirectDispatcher();
    return await fetch(input, withDispatcher(init, dispatcher));
  } catch (err) {
    if (proxyResponse) return proxyResponse;
    throw err;
  }
}
