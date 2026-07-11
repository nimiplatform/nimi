import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gatePath = path.join(scriptDir, 'check-no-public-runtime-account-token.mjs');

test('public Runtime account-token RPC has no proto, Runtime, SDK, Kit, or app surface', () => {
  const result = spawnSync(process.execPath, [gatePath], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /no public Runtime account-token surface: OK/u);
});
