import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanForSecrets } from "../../scripts/downstream/secret-scan.mjs";

// The QuantMeridian-Core build must never publish a secret (the downstream repository is public).
const dirs: string[] = [];
function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-scan-")); dirs.push(root);
  for (const [rel, text] of Object.entries(files)) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  return root;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("downstream secret scan", () => {
  it("passes a clean tree", () => {
    expect(scanForSecrets(tree({ "src/a.ts": "export const x = 1;\n", ".env.example": "MACRO_DB_URL=postgresql://user:pass@host/db\n" }), { allow_passwords: ["pass"] })).toEqual([]);
  });

  it("flags provider keys, tokens, and private keys without echoing them", () => {
    const secret = "sk-" + "a".repeat(30);
    const findings = scanForSecrets(tree({
      "src/k.ts": `const KEY = "${secret}";`,
      "docs/t.md": "token ghp_" + "b".repeat(30),
      "scripts/p.sh": "-----BEGIN " + "RSA PRIVATE KEY-----",
    })) as string[];
    expect(findings.sort()).toEqual(["docs/t.md:1: GitHub token", "scripts/p.sh:1: private key", "src/k.ts:1: provider key"]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("flags env files other than .env.example", () => {
    const findings = scanForSecrets(tree({ ".env": "A=1\n", "services/x/.env.local": "B=2\n", ".env.example": "A=\n" })) as string[];
    expect(findings.sort()).toEqual([".env: env file present (only .env.example may ship)", "services/x/.env.local: env file present (only .env.example may ship)"]);
  });

  it("flags database URLs with real-looking passwords but allows listed placeholders", () => {
    const root = tree({ "a.ts": 'const u = "postgresql://app:Zq8x7Lm2Pw@db.internal:5432/x";', "b.ts": 'const u = "postgresql://fred:fred@localhost:55432/macro";' });
    expect(scanForSecrets(root, { allow_passwords: ["fred"] })).toEqual(["a.ts:1: database URL with a non-placeholder password"]);
  });

  it("skips allowlisted paths, binary files, and dependency folders", () => {
    const root = tree({ "src/fixture.test.ts": 'const k = "sk-' + "c".repeat(30) + '";', "node_modules/x/index.js": "ghp_" + "d".repeat(30), "img/a.png": "ghp_" + "e".repeat(30) });
    expect(scanForSecrets(root, { allow_paths: ["src/**"] })).toEqual([]);
  });
});
