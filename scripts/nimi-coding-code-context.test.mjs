import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { spawnSyncCommand } from './lib/command-runner.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

test('pnpm exec nimicoding code context analyzes private top-level symbol with TypeScript 6.x', () => {
  const result = spawnSyncCommand(
    'pnpm',
    [
      'exec',
      'nimicoding',
      'code',
      'context',
      'kit/ui/src/toast/toast-store.ts',
      '--repo',
      '.',
      '--symbol',
      'emit',
      '--tsconfig',
      'kit/tsconfig.json',
      '--max-bytes',
      '50000',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, `Command failed with stderr: ${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.format, 'nimicoding.code-context-response/v1');
  assert.equal(payload.status, 'completed');
  assert.equal(payload.scope.symbol, 'emit');
  assert.equal(payload.scope.typescript_version, '6.0.3');
  assert.equal(payload.result.root.symbol, 'emit');
  assert.equal(payload.result.root.kind, 'function');
});

test('pnpm exec nimicoding code context handles non-existent symbol cleanly without crashing', () => {
  const result = spawnSyncCommand(
    'pnpm',
    [
      'exec',
      'nimicoding',
      'code',
      'context',
      'kit/ui/src/toast/toast-store.ts',
      '--repo',
      '.',
      '--symbol',
      'nonExistentSymbol123',
      '--tsconfig',
      'kit/tsconfig.json',
      '--max-bytes',
      '50000',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'refused');
  assert.equal(payload.error?.code, 'CODE_SYMBOL_NOT_FOUND');
});
