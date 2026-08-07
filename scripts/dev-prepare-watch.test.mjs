import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('Desktop owns dev surface preparation while supervised Apps only consume it', () => {
  const packageJson = (relativePath) => JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  const desktop = packageJson('apps/desktop/package.json');
  const tester = packageJson('apps/tester/package.json');
  const zhiyu = packageJson('apps/zhiyu/package.json');
  const avatar = packageJson('apps/avatar/package.json');
  const desktopDevRunner = readFileSync(
    path.join(repoRoot, 'apps/desktop/scripts/run-electron-dev.mjs'),
    'utf8',
  );

  assert.equal(
    desktop.scripts['build:electron'],
    'node ../../scripts/with-workspace-surfaces.mjs -- pnpm run build:electron:prepared',
  );
  assert.match(desktopDevRunner, /scripts['",\s]+dev-prepare-watch\.mjs/u);
  assert.match(desktopDevRunner, /build:electron:prepared/u);

  assert.equal(
    tester.scripts['build:electron'],
    'node ../../scripts/build-supervised-app-electron.mjs --consumer tester',
  );
  assert.equal(
    zhiyu.scripts['build:electron'],
    'node ../../scripts/build-supervised-app-electron.mjs --consumer zhiyu',
  );
  for (const command of [tester.scripts['build:electron'], zhiyu.scripts['build:electron']]) {
    assert.doesNotMatch(command, /build:(?:sdk|kit)|prepare:workspace-surfaces/u);
  }
  assert.equal(
    avatar.scripts['build:electron'],
    'pnpm run build:electron:prepared',
  );
});
