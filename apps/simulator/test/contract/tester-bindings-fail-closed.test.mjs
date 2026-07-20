import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'tester-bindings-fail-closed.ts',
);

test('Tester Simulator exposes only modeled positive outcomes and settles rejected diagnostics', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', helper], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    encoding: 'utf8',
  });
  assert.match(output, /tester-bindings-fail-closed: OK/u);
});
