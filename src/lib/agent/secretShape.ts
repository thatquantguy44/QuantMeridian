/**
 * Detect values that look like credentials or endpoints (spec009 NFR-005, AC-019).
 *
 * Configuration files may reference secrets and URLs only through environment variable *names*
 * (`*_env` fields). Anything that looks like a literal key, token, or URL anywhere in a settings
 * document is rejected. The same rules, and the same fixtures, are implemented in
 * services/agent_worker/src/agent_worker/settings.py.
 */

const SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ["url", /[a-z][a-z0-9+.-]*:\/\//i],
  ["bearer_token", /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
  ["api_key_prefix", /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["hex_blob", /^[0-9a-f]{32,}$/i],
  ["base64_blob", /^[A-Za-z0-9+/]{40,}={0,2}$/],
];

/** The kind of secret a string looks like, or null. */
export function secretShape(value: string): string | null {
  for (const [kind, pattern] of SHAPES) if (pattern.test(value)) return kind;
  return null;
}

export interface SecretShapedValue {
  path: string;
  kind: string;
}

/** Every string value or object key in `doc` that looks like a credential or URL. */
export function findSecretShapedValues(doc: unknown): SecretShapedValue[] {
  const found: SecretShapedValue[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      const kind = secretShape(node);
      if (kind) found.push({ path, kind });
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}/${i}`));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const kind = secretShape(key);
        if (kind) found.push({ path: `${path}/${key} (key)`, kind });
        walk(value, `${path}/${key}`);
      }
    }
  };
  walk(doc, "");
  return found;
}
