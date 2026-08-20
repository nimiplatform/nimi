import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assessWorkspaceSurfaceFreshness,
  canonicalSurfaceBuildCommand,
  captureWorkspaceSurfaceSnapshot,
  classifyWorkspaceSurfacePath,
  DEV_WORKSPACE_SURFACES,
  DEV_WORKSPACE_SURFACE_WATCH_TARGETS,
  resolveCanonicalSurfaceBuildPlan,
  workspaceSurfaceBuildDiagnostic,
} from './lib/dev-workspace-surfaces.mjs';
import {
  classifyWatchEventMetadata,
  findMetadataOnlySurfaces,
  quietBuildDelayMs,
  stableBuildSurfaces,
} from './lib/dev-build-scheduler.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('SDK changes rebuild SDK then Kit while Kit changes rebuild only Kit', () => {
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['sdk']), ['sdk', 'kit']);
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['kit']), ['kit']);
  assert.deepEqual(resolveCanonicalSurfaceBuildPlan(['kit', 'sdk']), ['sdk', 'kit']);
  assert.deepEqual(canonicalSurfaceBuildCommand('sdk'), ['build:sdk']);
  assert.deepEqual(canonicalSurfaceBuildCommand('kit'), ['build:kit']);
});

test('build scheduling waits for quiet after both edits and the previous build', () => {
  assert.equal(quietBuildDelayMs({ now: 1_000, lastChangeAt: 900, lastBuildCompletedAt: 0, quietMs: 500 }), 400);
  assert.equal(quietBuildDelayMs({ now: 1_000, lastChangeAt: 400, lastBuildCompletedAt: 800, quietMs: 500 }), 300);
  assert.equal(quietBuildDelayMs({ now: 1_500, lastChangeAt: 400, lastBuildCompletedAt: 800, quietMs: 500 }), 0);
  assert.deepEqual(
    stableBuildSurfaces(['sdk', 'kit'], { sdk: 2, kit: 4 }, { sdk: 2, kit: 5 }),
    ['sdk'],
  );
});

test('metadata-only watch events are droppable while edits and structural changes rebuild', () => {
  const graceMs = 30_000;
  const baselines = { sdk: 100_000, kit: 50_000 };
  assert.deepEqual(
    findMetadataOnlySurfaces(
      new Map([
        // Deferred last-access flush: content predates the completed build.
        ['sdk', { structural: false, newestMtimeMs: 60_000 }],
        // Recent edit inside the grace window must still rebuild.
        ['kit', { structural: false, newestMtimeMs: 45_000 }],
      ]),
      baselines,
      graceMs,
    ),
    ['sdk'],
  );
  assert.deepEqual(
    classifyWatchEventMetadata({ eventType: 'change', nodeKind: 'directory', mtimeMs: 1 }),
    { structural: false, mtimeMs: 1 },
  );
  assert.deepEqual(
    classifyWatchEventMetadata({ eventType: 'change', nodeKind: 'file', mtimeMs: 2 }),
    { structural: false, mtimeMs: 2 },
  );
  // Renames, deletions, and unsupported nodes are structural and never droppable.
  assert.deepEqual(
    classifyWatchEventMetadata({ eventType: 'rename', nodeKind: 'directory', mtimeMs: 1 }),
    { structural: true },
  );
  assert.deepEqual(
    classifyWatchEventMetadata({ eventType: 'change', nodeKind: 'missing', mtimeMs: 0 }),
    { structural: true },
  );
  assert.deepEqual(
    findMetadataOnlySurfaces(
      new Map([['sdk', { structural: true, newestMtimeMs: 1 }]]),
      baselines,
      graceMs,
    ),
    [],
  );
  // Without a completed-build baseline nothing is droppable.
  assert.deepEqual(
    findMetadataOnlySurfaces(
      new Map([['sdk', { structural: false, newestMtimeMs: 1 }]]),
      {},
      graceMs,
    ),
    [],
  );
});

test('watch classification ignores canonical build outputs and dependencies', () => {
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'tsconfig.json')), 'sdk');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/runtime/index.ts')), 'sdk');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/core-generated/runtime-client.ts')), 'sdk');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/runtime/client.test.ts')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/adapters/mastra/src/index.ts')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/README.md')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/core')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/ui/src/index.ts')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/features/chat/src/index.ts')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/electron/src/main/index.ts')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/scripts/build-package.mjs')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/package.json')), 'kit');
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/dist/index.js')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/.dist.staging-123/index.js')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'sdks/typescript/.dist.previous-123/index.js')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/node_modules/example/index.js')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/protected-local-node/target/release/addon.dll')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/protected-local-node')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/protected-local-node/npm/win32-x64')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/protected-local-node/npm/win32-x64/addon.node')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/protected-local-node/npm/win32-x64/index.cjs')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/features/chat/test/chat.test.ts')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/ui/src/button.test.tsx')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/CHANGELOG.md')), null);
  assert.equal(classifyWorkspaceSurfacePath(repoRoot, path.join(repoRoot, 'kit/shell/tauri/src/lib.rs')), null);
});

test('recursive watch targets never contain their surface dist directory', () => {
  for (const [surface, targets] of Object.entries(DEV_WORKSPACE_SURFACE_WATCH_TARGETS)) {
    const dist = path.resolve(repoRoot, DEV_WORKSPACE_SURFACES[surface].dist);
    for (const target of targets) {
      if (!target.recursive) continue;
      const root = path.resolve(repoRoot, target.root);
      const relativeDist = path.relative(root, dist);
      assert.equal(
        !relativeDist.startsWith('..') && !path.isAbsolute(relativeDist),
        false,
        `${surface} recursive watcher covers dist: ${target.root}`,
      );
    }
  }
});

test('freshness is fail-closed for missing stamps, missing dist and newer sources', () => {
  const snapshot = { sourceLatestMtimeUnixMs: 100, distLatestMtimeUnixMs: 110, outputComplete: true };
  assert.equal(assessWorkspaceSurfaceFreshness(null, 'sdk', snapshot).state, 'missing');
  const stamp = { schemaVersion: 1, surfaces: { sdk: { completedAtUnixMs: 105 } } };
  assert.equal(assessWorkspaceSurfaceFreshness(stamp, 'sdk', { ...snapshot, distLatestMtimeUnixMs: 0 }).state, 'stale');
  assert.equal(assessWorkspaceSurfaceFreshness(stamp, 'sdk', { ...snapshot, outputComplete: false }).state, 'stale');
  assert.equal(
    workspaceSurfaceBuildDiagnostic('sdk', { state: 'stale' }, { ...snapshot, outputComplete: false }),
    'sdk:dist-incomplete',
  );
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

test('freshness ignores native binding outputs just like watch classification', async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-surfaces-'));
  try {
    const sourceFile = path.join(temporaryRoot, 'kit', 'ui', 'src', 'index.ts');
    const nativeFile = path.join(
      temporaryRoot,
      'kit',
      'shell',
      'protected-local-node',
      'npm',
      'win32-x64',
      'addon.node',
    );
    const distFile = path.join(temporaryRoot, 'kit', 'dist', 'index.js');
    for (const filePath of [sourceFile, nativeFile, distFile]) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, 'fixture\n', 'utf8');
    }
    utimesSync(sourceFile, new Date(100_000), new Date(100_000));
    utimesSync(distFile, new Date(200_000), new Date(200_000));
    utimesSync(nativeFile, new Date(300_000), new Date(300_000));

    const snapshot = await captureWorkspaceSurfaceSnapshot(temporaryRoot, 'kit');
    assert.equal(snapshot.sourceLatestMtimeUnixMs, 100_000);
    assert.equal(snapshot.distLatestMtimeUnixMs, 200_000);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Desktop owns dev surface preparation while supervised Apps only consume it', () => {
  const packageJson = (relativePath) => JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  const desktop = packageJson('apps/desktop/package.json');
  const lab = packageJson('apps/lab/package.json');
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
    lab.scripts['build:electron'],
    'node ../../scripts/build-supervised-app-electron.mjs --consumer lab',
  );
  assert.equal(
    zhiyu.scripts['build:electron'],
    'node ../../scripts/build-supervised-app-electron.mjs --consumer zhiyu',
  );
  for (const command of [lab.scripts['build:electron'], zhiyu.scripts['build:electron']]) {
    assert.doesNotMatch(command, /build:(?:sdk|kit)|prepare:workspace-surfaces/u);
  }
  assert.equal(
    avatar.scripts['build:electron'],
    'pnpm run build:electron:prepared',
  );
});
