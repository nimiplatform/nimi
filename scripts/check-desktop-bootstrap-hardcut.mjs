#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

function runSearch(pattern, paths) {
  const existingPaths = paths.filter((targetPath) => fs.existsSync(path.join(repoRoot, targetPath)));
  if (existingPaths.length === 0) {
    return '';
  }

  const tryCommand = (cmd, args) => {
    try {
      return execFileSync(cmd, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null; // Command not found
      }
      if (typeof error.status === 'number' && error.status === 1) {
        return ''; // No matches
      }
      throw error;
    }
  };

  // Try ripgrep (rg) first
  let result = tryCommand('rg', ['-n', pattern, ...existingPaths]);
  if (result !== null) return result;

  // Fallback to grep -E
  result = tryCommand('grep', ['-En', pattern, ...existingPaths]);
  if (result !== null) return result;

  throw new Error('desktop bootstrap hardcut requires `rg` or `grep` to be installed');
}

const failures = [];

for (const check of checks) {
  const matches = runSearch(check.pattern, check.paths);
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
