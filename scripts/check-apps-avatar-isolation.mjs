#!/usr/bin/env node
// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit (design-12).
// Static scanner enforcing apps/avatar self-contained import policy.
//
// Policy:
//   apps/avatar/src/** must NOT import:
//     - @nimiplatform/nimi-kit/features/avatar (any subpath)
//     - apps/desktop/, apps/web/, apps/forge/, apps/realm-drift/,
//       apps/install-gateway/, apps/overtone/ (any subpath)
//     - _external/ (any subpath; reference-only)
//   tsconfig path aliases are resolved before matching, so
//     `@renderer/...` -> `apps/avatar/src/shell/renderer/...` is allowed
//     but a hypothetical alias to apps/desktop would be rejected.
//   apps/avatar/vendored/** is allowed only when the directory exists.
//
// Exit:
//   0 = PASS (no violations)
//   1 = FAIL (violations printed file:line + offending specifier)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const AVATAR_SRC = path.join(ROOT, 'apps', 'avatar', 'src');
const TSCONFIG_PATH = path.join(ROOT, 'apps', 'avatar', 'tsconfig.json');
const VENDORED_DIR = path.join(ROOT, 'apps', 'avatar', 'vendored');

// ─── banned specifier matchers ─────────────────────────────────────────
// each entry: { test: (specifier: string) => boolean, label: string }
const BANNED = [
  {
    label: '@nimiplatform/nimi-kit/features/avatar',
    test: (s) =>
      s === '@nimiplatform/nimi-kit/features/avatar' ||
      s.startsWith('@nimiplatform/nimi-kit/features/avatar/'),
  },
  {
    label: 'cross-app: apps/desktop',
    test: (s) => /(^|\/)apps\/desktop(\/|$)/.test(s),
  },
  {
    label: 'cross-app: apps/web',
    test: (s) => /(^|\/)apps\/web(\/|$)/.test(s),
  },
  {
    label: 'cross-app: apps/forge',
    test: (s) => /(^|\/)apps\/forge(\/|$)/.test(s),
  },
  {
    label: 'cross-app: apps/realm-drift',
    test: (s) => /(^|\/)apps\/realm-drift(\/|$)/.test(s),
  },
  {
    label: 'cross-app: apps/install-gateway',
    test: (s) => /(^|\/)apps\/install-gateway(\/|$)/.test(s),
  },
  {
    label: 'cross-app: apps/overtone',
    test: (s) => /(^|\/)apps\/overtone(\/|$)/.test(s),
  },
  {
    label: '_external/ runtime reference',
    test: (s) => /(^|\/)_external(\/|$)/.test(s),
  },
];

// ─── tsconfig path alias loading ──────────────────────────────────────
async function loadTsconfigAliases() {
  let raw;
  try {
    raw = await fs.readFile(TSCONFIG_PATH, 'utf8');
  } catch (err) {
    return [];
  }
  // strip JSON5 trailing commas + // line comments + /* */ block comments
  // (avatar tsconfig is plain JSON; this is defensive)
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return [];
  }
  const paths = parsed?.compilerOptions?.paths ?? {};
  const aliases = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    aliases.push({ pattern, target: targets[0] });
  }
  return aliases;
}

function aliasResolve(specifier, aliases) {
  for (const { pattern, target } of aliases) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (specifier === prefix || specifier.startsWith(prefix + '/')) {
        const tail = specifier.slice(prefix.length + 1);
        return path.posix.normalize(target.replace('/*', '/' + tail));
      }
    } else if (specifier === pattern) {
      return path.posix.normalize(target);
    }
  }
  return null;
}

// ─── source scanning ──────────────────────────────────────────────────
async function walkDir(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkDir(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) {
      out.push(full);
    }
  }
}

// regex-based extraction: import / require / dynamic import
// matches:
//   import ... from 'spec'
//   import 'spec'
//   import('spec')
//   require('spec')
//   export ... from 'spec'
const IMPORT_RE = /(?:^|[^.\w])(?:import|export)\s*(?:[\s\S]*?from\s*)?["']([^"']+)["']|(?:^|[^.\w])(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

async function scanFile(file) {
  const source = await fs.readFile(file, 'utf8');
  const lines = source.split(/\r?\n/);
  const findings = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source))) {
    const specifier = m[1] || m[2];
    if (!specifier) continue;
    // compute 1-based line number
    const upToHere = source.slice(0, m.index);
    const lineNo = upToHere.split(/\r?\n/).length;
    findings.push({ specifier, line: lineNo, text: lines[lineNo - 1]?.trim() ?? '' });
  }
  return findings;
}

function inVendoredAllowlist(specifier, sourceFile, vendoredExists) {
  if (!vendoredExists) return false;
  // allow any specifier that resolves into apps/avatar/vendored/
  if (specifier.includes('apps/avatar/vendored/')) return true;
  // relative path inside src/ that climbs into vendored/
  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(sourceFile), specifier);
    if (resolved.startsWith(VENDORED_DIR + path.sep)) return true;
  }
  return false;
}

async function main() {
  const aliases = await loadTsconfigAliases();
  const files = [];
  await walkDir(AVATAR_SRC, files);

  let vendoredExists = false;
  try {
    const stat = await fs.stat(VENDORED_DIR);
    vendoredExists = stat.isDirectory();
  } catch {
    vendoredExists = false;
  }

  let violationCount = 0;
  for (const file of files) {
    const findings = await scanFile(file);
    for (const f of findings) {
      const specifier = f.specifier;
      // resolve alias if it matches one
      const resolved = aliasResolve(specifier, aliases) ?? specifier;
      const candidates = [specifier, resolved];

      let hit = null;
      for (const cand of candidates) {
        for (const rule of BANNED) {
          if (rule.test(cand)) {
            hit = { rule, cand };
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) continue;

      // vendored allowlist exception
      if (inVendoredAllowlist(specifier, file, vendoredExists)) continue;

      const rel = path.relative(ROOT, file);
      console.error(
        `[isolation] ${rel}:${f.line}  '${specifier}'` +
          (resolved !== specifier ? ` (resolves to '${resolved}')` : '') +
          `  → banned: ${hit.rule.label}`,
      );
      console.error(`             ${f.text}`);
      violationCount += 1;
    }
  }

  if (violationCount === 0) {
    console.log('[isolation] PASS — apps/avatar/src has no banned imports');
    process.exit(0);
  } else {
    console.error(`[isolation] FAIL — ${violationCount} banned import(s) found`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[isolation] internal error:', err);
  process.exit(2);
});
