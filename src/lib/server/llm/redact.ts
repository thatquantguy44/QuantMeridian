/** Redaction for provider errors and logs (spec009 NFR-005): no credential, header value, or URL leaves the server. */
type Env = Record<string, string | undefined>;

export function redactMessage(message: string, secretEnvNames: readonly string[], env: Env = process.env): string {
  let out = message;
  for (const name of secretEnvNames) {
    const value = env[name]?.trim();
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|key|tok|xox[abp])-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/https?:\/\/[^\s"'<>)]+/gi, "[url]")
    .slice(0, 300);
}
