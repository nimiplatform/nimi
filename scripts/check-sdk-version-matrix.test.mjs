import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareSemver,
  detectRuntimeSurfaceVersionContext,
  isRuntimeSurfaceVersionAdvanced,
  resolvePublicRuntimeSurfacePaths,
  selectLatestPublishedSdkRef,
} from './check-sdk-version-matrix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolvePublicRuntimeSurfacePaths derives existing source files from @nimiplatform/sdk exports', () => {
  const sdkPkg = JSON.parse(readFileSync(path.join(repoRoot, 'sdks/typescript/package.json'), 'utf8'));
  const surfacePaths = resolvePublicRuntimeSurfacePaths(sdkPkg.exports);

  assert.deepEqual(surfacePaths, [
    'sdks/typescript/runtime/generated.ts',
    'sdks/typescript/runtime/host.ts',
    'sdks/typescript/runtime/index.ts',
    'sdks/typescript/runtime/remote.ts',
    'sdks/typescript/runtime/wire-types/index.ts',
    'sdks/typescript/types/index.ts',
  ]);
  for (const relativePath of surfacePaths) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `missing exported surface file: ${relativePath}`);
  }
});

test('selectLatestPublishedSdkRef uses semver ordering and handles HEAD-tagged release checkouts', () => {
  assert.ok(compareSemver('0.24.0', '0.24.0-rc.11') > 0);
  assert.ok(compareSemver('0.24.0-rc.11', '0.24.0-rc.2') > 0);

  const tags = [
    { ref: 'sdk/v0.22.2', commit: 'commit-222' },
    { ref: 'sdk/v0.24.0-rc.2', commit: 'commit-rc2' },
    { ref: 'sdk/v0.24.0-rc.11', commit: 'commit-rc11' },
    { ref: 'sdk/v0.24.0', commit: 'commit-240' },
  ];

  // Stable 0.24.0 outranks 0.24.0-rc.11 despite git's default lexical suffix sort.
  assert.equal(selectLatestPublishedSdkRef(tags, { headCommit: 'commit-next' }), 'sdk/v0.24.0');

  // Clean checkout right on a release tag skips the tag on HEAD and compares against the prior tag.
  assert.equal(
    selectLatestPublishedSdkRef(tags, { headCommit: 'commit-240', hasWorktreeSurfaceChanges: false }),
    'sdk/v0.24.0-rc.11',
  );

  // Dirty worktree on a tagged commit keeps that tag as the already-published baseline.
  assert.equal(
    selectLatestPublishedSdkRef(tags, { headCommit: 'commit-240', hasWorktreeSurfaceChanges: true }),
    'sdk/v0.24.0',
  );

  // Explicit override always wins.
  assert.equal(
    selectLatestPublishedSdkRef(tags, { override: 'sdk/v0.22.2', headCommit: 'commit-240' }),
    'sdk/v0.22.2',
  );
});

test('isRuntimeSurfaceVersionAdvanced enforces prerelease progression and major.minor bumps after stable', () => {
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.24.0-rc.11', '0.24.0-rc.12'), true);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.24.0-rc.11', '0.24.0'), true);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.24.0-rc.11', '0.24.0-rc.11'), false);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.24.0-rc.11', '0.24.0-rc.10'), false);

  assert.equal(isRuntimeSurfaceVersionAdvanced('0.22.2', '0.23.0'), true);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.22.2', '0.24.0-rc.1'), true);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.22.2', '0.22.3'), false);
  assert.equal(isRuntimeSurfaceVersionAdvanced('0.22.2', '0.22.2'), false);
});

test('detectRuntimeSurfaceVersionContext resolves baseline tag and changed surface paths cleanly', () => {
  const surfacePaths = ['sdks/typescript/runtime/index.ts', 'sdks/typescript/runtime/remote.ts'];
  const gitRunner = (args) => {
    if (args[0] === 'diff' && args[2] === 'HEAD') {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-parse') {
      return { status: 0, stdout: 'head-oid\n', stderr: '' };
    }
    if (args[0] === 'for-each-ref') {
      return {
        status: 0,
        stdout: [
          'sdk/v0.24.0-rc.11\tprev-oid\ttag-obj-11',
          'sdk/v0.24.0-rc.12\thead-oid\ttag-obj-12',
        ].join('\n'),
        stderr: '',
      };
    }
    if (args[0] === 'diff' && args[2] === 'sdk/v0.24.0-rc.11...HEAD') {
      return { status: 0, stdout: 'sdks/typescript/runtime/remote.ts\n', stderr: '' };
    }
    if (args[0] === 'show' && args[1] === 'sdk/v0.24.0-rc.11:sdks/typescript/package.json') {
      return { status: 0, stdout: JSON.stringify({ version: '0.24.0-rc.11' }), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected git args: ${args.join(' ')}` };
  };

  const context = detectRuntimeSurfaceVersionContext('0.24.0-rc.12', surfacePaths, {
    gitRunner,
    overrideRef: '',
  });
  assert.deepEqual(context, {
    baseRef: 'sdk/v0.24.0-rc.11',
    changedSurfacePaths: ['sdks/typescript/runtime/remote.ts'],
    baseVersion: '0.24.0-rc.11',
    currentVersion: '0.24.0-rc.12',
    comparisonLabel: 'sdk/v0.24.0-rc.11 -> current candidate',
  });
});
