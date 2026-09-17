import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'lab-bindings-fail-closed.ts',
);
const tsxImport = import.meta.resolve('tsx');

test('Lab Simulator exposes only modeled positive outcomes and settles rejected diagnostics', () => {
  const output = execFileSync(process.execPath, ['--import', tsxImport, helper], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    encoding: 'utf8',
  });
  assert.match(output, /lab-bindings-fail-closed: OK/u);
});
