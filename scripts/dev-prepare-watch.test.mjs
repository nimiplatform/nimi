import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assessWorkspaceSurfaceFreshness,
  canonicalSurfaceBuildCommand,
  classifyWorkspaceSurfacePath,
  resolveCanonicalSurfaceBuildPlan,
  workspaceSurfaceBuildDiagnostic,
} from './lib/dev-workspace-surfaces.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('SDK changes rebuild SDK then Kit while Kit changes rebuild only Kit', () => {
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['sdk']), ['sdk', 'kit']);
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['kit']), ['kit']);
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['kit', 'sdk']), ['sdk', 'kit']);
  assert.deepEqual(canonicalSurfaceBuildCommand('sdk'), ['build:sdk']);
  assert.deepEqual(canonicalSurfaceBuildCommand('kit'), ['build:kit']);
});

test('watch classification ignores canonical build outputs and dependencies', () => {
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/runtime/index.ts')), 'sdk');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/ui/index.ts')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/dist/index.js')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/node_modules/example/index.js')), null);
});

test('freshness is fail-closed for missing stamps, missing dist and newer sources', () => {
  const snapshot = { sourceLatestMtimeUnixMs: 100, distLatestMtimeUnixMs: 110 };
  assert.equal(assessWorkspaceSurfaceFreshness(null, 'sdk', snapshot).state, 'missing');
  const stamp = { schemaVersion: 1, surfaces: { sdk: { completedAtUnixMs: 105 } } };
  assert.equal(assessWorkspaceSurfaceFreshness(stamp, 'sdk', { ...snapshot, distLatestMtimeUnixMs: 0 }).state, 'stale');
  assert.equal(assessWorkspaceSurfaceFreshness(stamp, 'sdk', { ...snapshot, sourceLatestMtimeUnixMs: 106 }).state, 'stale');
  assert.equal(assessWorkspaceSurfaceFreshness(stamp, 'sdk', snapshot).state, 'fresh');
  assert.equal(
    workspaceSurfaceBuildDiagnostic(
      'sdk',
      { state: 'stale', reason: 'dev-workspace-surface-source-newer-than-build' },
      { sourceLatestMtimeUnixMs: 120, distLatestMtimeUnixMs: 110 },
    ),
    'sdk:dist-stale',
  );
  assert.equal(
    workspaceSurfaceBuildDiagnostic('sdk', { state: 'fresh' }, snapshot),
    null,
  );
});
