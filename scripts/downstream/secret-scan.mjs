/**
 * Public-safety scan for the QuantMeridian-Core build. The downstream repository is public, so the
 * build fails (not just warns) on high-confidence secrets: provider keys, tokens, private keys, DB
 * URLs with real-looking passwords, and env files other than the example.
 */
import fs from "node:fs";
import path from "node:path";

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|py|sh|md|yml|yaml|toml|env|example|txt|ini|cfg|html|css|bat|sql)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-server", "dist-tools", "dist-vercel"]);

const KEY_PATTERNS = [
  ["provider key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const URL_CREDENTIALS = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^\s"'<>/:@]+):([^\s"'<>@$]+)@/g;

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);

function* walk(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, base);
    else yield path.relative(base, full).split(path.sep).join("/");
  }
}

/**
 * @param {string} root build output directory
 * @param {{ allow_paths?: string[], allow_passwords?: string[] }} rules
 * @returns {string[]} one human-readable finding per problem (never includes the secret itself)
 */
export function scanForSecrets(root, rules = {}) {
  const allowPaths = (rules.allow_paths ?? []).map(globToRegExp);
  const allowPasswords = new Set((rules.allow_passwords ?? []).map((p) => p.toLowerCase()));
  const findings = [];
  for (const rel of walk(root)) {
    const name = path.posix.basename(rel);
    if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") findings.push(`${rel}: env file present (only .env.example may ship)`);
    if (allowPaths.some((re) => re.test(rel)) || !TEXT.test(name)) continue;
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    text.split("\n").forEach((line, i) => {
      for (const [label, re] of KEY_PATTERNS) if (re.test(line)) findings.push(`${rel}:${i + 1}: ${label}`);
      for (const match of line.matchAll(URL_CREDENTIALS)) {
        if (!allowPasswords.has(match[2].toLowerCase())) findings.push(`${rel}:${i + 1}: database URL with a non-placeholder password`);
      }
    });
  }
  return findings;
}
