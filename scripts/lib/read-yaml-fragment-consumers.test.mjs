import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readYamlWithFragments } from './read-yaml-with-fragments.mjs';
import { readYaml as readSdkGeneratorYaml, repoRoot } from '../../sdks/generators/lib/context.mjs';

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

test('shared YAML reader resolves fragment-backed tables', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-yaml-fragments-'));
  const tablePath = path.join(tempDir, 'table.yaml');
  writeFile(tablePath, `
version: 1
fragments:
  values:
    - values-a.yaml
    - values-b.yaml
`);
  writeFile(path.join(tempDir, 'values-a.yaml'), `
values:
  - FIRST
`);
  writeFile(path.join(tempDir, 'values-b.yaml'), `
values:
  - SECOND
`);

  const table = readYamlWithFragments(tablePath);
  assert.deepEqual(table.values, ['FIRST', 'SECOND']);
});

test('SDK generator readYaml resolves fragment-backed repo tables', () => {
  const tempRoot = path.join(repoRoot, '.local', 'tmp', `sdk-yaml-fragments-${process.pid}-${Date.now()}`);
  const rel = path.relative(repoRoot, path.join(tempRoot, 'table.yaml')).replaceAll(path.sep, '/');
  try {
    writeFile(path.join(tempRoot, 'table.yaml'), `
version: 1
fragments:
  codes:
    - codes-a.yaml
    - codes-b.yaml
`);
    writeFile(path.join(tempRoot, 'codes-a.yaml'), `
codes:
  - name: FIRST
`);
    writeFile(path.join(tempRoot, 'codes-b.yaml'), `
codes:
  - name: SECOND
`);

    const table = readSdkGeneratorYaml(rel);
    assert.deepEqual(table.codes.map((entry) => entry.name), ['FIRST', 'SECOND']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
