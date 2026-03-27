#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const checks = [
  {
    description: 'desktop typed bootstrap capabilities must not downgrade typed responses through toObjectOr fallback objects',
    pattern: 'toObjectOr\\(',
    paths: [
      'apps/desktop/src/shell/renderer/infra/bootstrap/world-capabilities.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/core-capabilities.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/creator-capabilities.ts',
    ],
  },
  {
    description: 'desktop typed bootstrap capabilities must not treat failure as empty list or empty object success',
    pattern: 'return \\{ items: \\[\\] \\}|worldId:\\s*\'\', items:\\s*\\[\\]|return \\{\\}|return null;',
    paths: [
      'apps/desktop/src/shell/renderer/infra/bootstrap/world-capabilities.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/core-capabilities.ts',
      'apps/desktop/src/shell/renderer/infra/bootstrap/creator-capabilities.ts',
    ],
  },
  {
    description: 'desktop world detail supplemental queries must not collapse failed typed loads into empty-success placeholder payloads',
    pattern: 'worldEventsQuery\\.data \\?\\? \\{ items: \\[\\], summary: null \\}|worldSemanticQuery\\.data \\?\\? \\{|worldAuditQuery\\.data \\?\\? \\[\\]|worldPublicAssetsQuery\\.data \\?\\? \\{',
    paths: [
      'apps/desktop/src/shell/renderer/features/world/world-detail.tsx',
    ],
  },
];

function runRipgrep(pattern, paths) {
  try {
    return execFileSync('rg', ['-n', pattern, ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('desktop bootstrap hardcut requires `rg` to be installed');
    }
    if (typeof error.status === 'number' && error.status === 1) {
      return '';
    }
    throw error;
  }
}

const failures = [];

for (const check of checks) {
  const matches = runRipgrep(check.pattern, check.paths);
  if (matches) {
    failures.push(`[desktop-bootstrap-hardcut] ${check.description}\n${matches}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log('[desktop-bootstrap-hardcut] Passed.');
