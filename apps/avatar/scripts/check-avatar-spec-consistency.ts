// Avatar spec consistency check.
// Validates that:
//  1. Required spec authority files exist on disk (kernel + tables + guide).
//  2. Wave 2 implementation surfaces (i18n locales + tokens.css) exist.
//  3. Every i18n key listed in `spec/kernel/tables/i18n-keys.yaml` is
//     present in BOTH `locales/en/avatar.json` and `locales/zh/avatar.json`,
//     and no orphan keys exist in either locale file (1:1 alignment).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const requiredPaths = [
  'spec/kernel/index.md',
  'spec/kernel/embodiment-projection-contract.md',
  'spec/kernel/agent-script-contract.md',
  'spec/kernel/avatar-event-contract.md',
  'spec/kernel/app-shell-contract.md',
  'spec/kernel/live2d-render-contract.md',
  'spec/kernel/live2d-asset-compatibility-contract.md',
  'spec/kernel/carrier-visual-acceptance-contract.md',
  'spec/kernel/mock-fixture-contract.md',
  'spec/kernel/tables/feature-matrix.yaml',
  'spec/kernel/tables/activity-mapping.yaml',
  'spec/kernel/tables/live2d-compatibility-tiers.yaml',
  'spec/kernel/tables/scenario-catalog.yaml',
  'spec/kernel/tables/i18n-keys.yaml',
  'spec/nimi-avatar.md',
  'src/shell/renderer/locales/en/avatar.json',
  'src/shell/renderer/locales/zh/avatar.json',
  'src/shell/renderer/app-shell/tokens.css',
];

const missing = requiredPaths
  .map((relativePath) => ({
    relativePath,
    absolutePath: resolve(ROOT, relativePath),
  }))
  .filter(({ absolutePath }) => !existsSync(absolutePath));

if (missing.length > 0) {
  console.error('Avatar spec consistency check failed. Missing required authority files:');
  for (const entry of missing) {
    console.error(`- ${entry.relativePath}`);
  }
  process.exit(1);
}

// Extract i18n key declarations from the YAML table without pulling in a
// full YAML parser — keys are emitted as `      - key: <value>` lines.
function readSpecKeys(): string[] {
  const yamlPath = resolve(ROOT, 'spec/kernel/tables/i18n-keys.yaml');
  const yaml = readFileSync(yamlPath, 'utf8');
  const keys: string[] = [];
  for (const rawLine of yaml.split('\n')) {
    const match = /^\s*-\s+key:\s+(\S+)\s*$/.exec(rawLine);
    if (match) keys.push(match[1]);
  }
  if (keys.length === 0) {
    throw new Error('spec/kernel/tables/i18n-keys.yaml declares zero keys');
  }
  return keys;
}

// Flatten a nested object into dot-namespaced leaves.
function flattenKeys(obj: unknown, prefix: string, sink: string[]): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, next, sink);
    } else {
      sink.push(next);
    }
  }
}

function readLocaleKeys(relativePath: string): { keys: string[]; emptyKeys: string[] } {
  const fullPath = resolve(ROOT, relativePath);
  const json = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  const collected: string[] = [];
  flattenKeys(json, '', collected);
  const emptyKeys: string[] = [];
  // Re-walk to detect empty/whitespace-only leaves.
  function walk(obj: unknown, prefix: string): void {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, next);
      } else if (typeof v !== 'string' || v.trim().length === 0) {
        emptyKeys.push(next);
      }
    }
  }
  walk(json, '');
  return { keys: collected, emptyKeys };
}

const specKeys = readSpecKeys();
const enLocale = readLocaleKeys('src/shell/renderer/locales/en/avatar.json');
const zhLocale = readLocaleKeys('src/shell/renderer/locales/zh/avatar.json');

const errors: string[] = [];

const specKeySet = new Set(specKeys);
const enKeySet = new Set(enLocale.keys);
const zhKeySet = new Set(zhLocale.keys);

const enMissing = specKeys.filter((k) => !enKeySet.has(k));
const zhMissing = specKeys.filter((k) => !zhKeySet.has(k));
const enOrphan = enLocale.keys.filter((k) => !specKeySet.has(k));
const zhOrphan = zhLocale.keys.filter((k) => !specKeySet.has(k));

if (enMissing.length > 0) {
  errors.push(`locales/en/avatar.json is missing ${enMissing.length} key(s) declared in i18n-keys.yaml:\n  - ${enMissing.join('\n  - ')}`);
}
if (zhMissing.length > 0) {
  errors.push(`locales/zh/avatar.json is missing ${zhMissing.length} key(s) declared in i18n-keys.yaml:\n  - ${zhMissing.join('\n  - ')}`);
}
if (enOrphan.length > 0) {
  errors.push(`locales/en/avatar.json has ${enOrphan.length} orphan key(s) not declared in i18n-keys.yaml:\n  - ${enOrphan.join('\n  - ')}`);
}
if (zhOrphan.length > 0) {
  errors.push(`locales/zh/avatar.json has ${zhOrphan.length} orphan key(s) not declared in i18n-keys.yaml:\n  - ${zhOrphan.join('\n  - ')}`);
}
if (enLocale.emptyKeys.length > 0) {
  errors.push(`locales/en/avatar.json has ${enLocale.emptyKeys.length} empty / non-string leaf(s):\n  - ${enLocale.emptyKeys.join('\n  - ')}`);
}
if (zhLocale.emptyKeys.length > 0) {
  errors.push(`locales/zh/avatar.json has ${zhLocale.emptyKeys.length} empty / non-string leaf(s):\n  - ${zhLocale.emptyKeys.join('\n  - ')}`);
}

if (errors.length > 0) {
  console.error('Avatar spec consistency check failed. i18n drift detected:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log('Avatar spec consistency check passed.');
console.log(`- ${requiredPaths.length} required authority files present`);
console.log(`- ${specKeys.length} i18n keys aligned across spec / en / zh`);
