import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gatePath = path.join(scriptDir, 'check-public-raw-token-authority.mjs');
const fixtures = JSON.parse(fs.readFileSync(path.join(scriptDir, 'testdata/public-raw-token-authority/negative-fixtures.json'), 'utf8'));

test('public Runtime account-token authority is physically removed across canonical projections', () => {
  const result = spawnSync(process.execPath, [gatePath], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /public raw-token authority hardcut: OK/u);
});

test('negative fixtures mutate one current removal invariant and produce one stable code', () => {
  const result = spawnSync(process.execPath, [gatePath, '--fixture-report-json'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.fixtures.map((fixture) => fixture.code), fixtures.map((fixture) => fixture.code));
  for (const fixture of report.fixtures) assert.equal(fixture.issue_count, 1);
});

test('gate rejects unknown arguments', () => {
  const result = spawnSync(process.execPath, [gatePath, '--unknown'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /ARGUMENT_ERROR/u);
});
