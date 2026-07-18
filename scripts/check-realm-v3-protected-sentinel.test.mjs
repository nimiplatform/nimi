import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const scriptPath = path.join(scriptDir, 'check-realm-v3-protected-sentinel.mjs');
const manifestPath = path.join(repoRoot, 'config', 'realm-v3', 'protected-sentinel.json');

function run(manifestRelativePath = undefined) {
  const args = [scriptPath];
  if (manifestRelativePath) args.push('--manifest', manifestRelativePath);
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runMutation(mutate) {
  const directory = fs.mkdtempSync(path.join(repoRoot, 'config', 'realm-v3', '.sentinel-test-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    mutate(manifest);
    const candidatePath = path.join(directory, 'candidate.json');
    fs.writeFileSync(candidatePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return run(path.relative(repoRoot, candidatePath).replaceAll('\\', '/'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts the exact admitted permission-authority implementation baseline', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.implementationBaseline.admission.changeClass, 'ecosystem_third_party_permission_authority_hardcut');
  assert.equal(report.unapprovedProtectedDiffs, 0);
});

test('rejects an admitted baseline whose declared parent is not the Git parent', () => {
  const result = runMutation((manifest) => {
    manifest.implementationBaseline.admitted.parent = '0'.repeat(40);
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /admitted protected baseline parent mismatch/u);
});

test('rejects an incomplete protected-change inventory', () => {
  const result = runMutation((manifest) => {
    manifest.implementationBaseline.admitted.protectedChangePaths.pop();
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /admitted protected path inventory mismatch/u);
});

test('rejects an authority migration without canonical rule references', () => {
  const result = runMutation((manifest) => {
    manifest.authorizedAuthorityMigrations[0].authorityRefs = [];
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /has no authority references/u);
});
