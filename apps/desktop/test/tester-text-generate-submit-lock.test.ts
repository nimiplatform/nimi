import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readTextGeneratePanel(): string {
  return fs.readFileSync(
    path.join(
      import.meta.dirname,
      '..',
      'src',
      'shell',
      'renderer',
      'features',
      'tester',
      'panels',
      'panel-text-generate.tsx',
    ),
    'utf8',
  );
}

test('tester text generate submit path prevents duplicate in-flight runs', () => {
  const source = readTextGeneratePanel();

  assert.match(source, /const runLockRef = React\.useRef\(false\)/);
  assert.match(source, /if \(runLockRef\.current\) \{\s*return;\s*\}/);
  assert.match(source, /runLockRef\.current = true;/);
  assert.match(source, /finally \{\s*runLockRef\.current = false;\s*\}/);
});
