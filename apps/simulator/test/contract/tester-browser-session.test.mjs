import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'tester-browser-session.tsx',
);

test('one React root isolates two Tester DOM assignments and returns lifecycle resources to session baseline', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', helper], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    encoding: 'utf8',
  });
  assert.match(output, /tester-browser-session-integration: OK/u);
});
