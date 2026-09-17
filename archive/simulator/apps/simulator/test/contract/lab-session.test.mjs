import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'lab-session.tsx',
);
const tsxImport = import.meta.resolve('tsx');

test('real Lab Adapter and canonical factory support two instances, readiness, reset, and reopen', () => {
  const output = execFileSync(process.execPath, ['--import', tsxImport, helper], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    encoding: 'utf8',
  });
  assert.match(output, /lab-session-integration: OK/u);
});
