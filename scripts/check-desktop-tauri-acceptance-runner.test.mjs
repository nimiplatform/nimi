import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(
  repoRoot,
  '.local/report/desktop-tauri-shell-refactor/run-tauri-acceptance.mjs',
);

test('desktop tauri acceptance runner fails closed when failure or disabled state evidence is missing', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');

  assert.match(
    source,
    /if\s*\(\s*!checks\.failureOrDisabledStateObserved\s*\)\s*{\s*throw new Error\('Failure or disabled state was not observed\.'\);?\s*}/s,
  );
  assert.match(source, /failureProbe/);
  assert.match(source, /startDirectory:\s*'relative\/path'/);
  assert.match(source, /failureProbe\?\.ok === false/);
});
