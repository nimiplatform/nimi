import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'tester-session.tsx',
);

test('real Tester Adapter and canonical factory support two instances, readiness, reset, and reopen', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', helper], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    encoding: 'utf8',
  });
  assert.match(output, /tester-session-integration: OK/u);
});
