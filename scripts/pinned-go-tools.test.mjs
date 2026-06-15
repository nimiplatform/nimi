import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

test('pinned Go tool resolver accounts for Windows executable suffixes', () => {
  const source = readFileSync(path.join(scriptsDir, 'lib', 'pinned-go-tools.mjs'), 'utf8');
  assert.match(source, /process\.platform !== 'win32'/);
  assert.match(source, /process\.env\.PATHEXT \|\| '\.COM;\.EXE;\.BAT;\.CMD'/);
  assert.match(source, /binaryNames\(config\.binary\)\.map/);
  assert.match(source, /installedCandidates\.join\(', '\)/);
  assert.doesNotMatch(source, /path\.join\(binDir, config\.binary\);\s*if \(!isExecutable\(installedPath\)\)/);
});
