import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

test('resolvePublicRuntimeSurfacePaths includes sources behind the workspace SDK entrypoints', () => {
  const sdkPkg = JSON.parse(readFileSync(path.join(repoRoot, 'sdks/typescript/package.json'), 'utf8'));
  const surfacePaths = resolvePublicRuntimeSurfacePaths(sdkPkg.exports);

  assert.ok(surfacePaths.includes('sdks/typescript/runtime/product-control-types.ts'));
  assert.ok(surfacePaths.includes('sdks/typescript/types/errors.ts'));
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

function releaseFixture(t) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-version-matrix-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const packageRoot = path.join(workspaceRoot, 'sdks/typescript');
  const manifest = {
    version: '0.24.0-rc.12',
    exports: {
      './runtime': { types: './dist/runtime/index.d.ts', import: './dist/runtime/index.js' },
      './types': './dist/types/index.js',
    },
  };
  const write = (file, content) => {
    const absolute = path.join(packageRoot, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  const gitRunner = args => spawnSync('git', args, { cwd: workspaceRoot, encoding: 'utf8' });
  const git = args => {
    const result = gitRunner(args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = message => {
    git(['add', '.']);
    git(['-c', 'user.name=SDK Test', '-c', 'user.email=sdk@example.invalid', '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=.git/hooks', 'commit', '-qm', message]);
  };
  write('package.json', JSON.stringify(manifest));
  write('runtime/index.ts', "export type { Record } from './barrel.js';\n");
  write('runtime/barrel.ts', "import type { Record } from './product-control-types';\nexport type { Record };\n");
  write('runtime/product-control-types.ts', 'export interface Record { version: 1 }\n');
  write('runtime/private.test.ts', 'export const testFixture = true;\n');
  write('types/index.ts', 'export type ReasonCode = string;\n');
  git(['init', '-q']);
  commit('Published SDK fixture');
  const overrideRef = git(['rev-parse', 'HEAD']);
  const check = () => detectRuntimeSurfaceVersionContext(
    JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')),
    { gitRunner, overrideRef, workspaceRoot },
  );
  return { check, commit, manifest, write };
}

test('committed changes behind a public re-export require a version advance', t => {
  const fixture = releaseFixture(t);
  assert.equal(fixture.check(), null);
  fixture.write('runtime/product-control-types.ts', 'export interface Record { version: 2 }\n');
  fixture.commit('Change a re-exported type');

  const context = fixture.check();
  assert.deepEqual(context?.changedSurfacePaths, ['sdks/typescript/runtime/product-control-types.ts']);
  assert.equal(isRuntimeSurfaceVersionAdvanced(context.baseVersion, context.currentVersion), false);
});

test('runtime export removal is detected in the manifest before and after commit', t => {
  const fixture = releaseFixture(t);
  fixture.write('runtime/private.test.ts', 'export const testFixture = false;\n');
  fixture.write('package.json', JSON.stringify({ ...fixture.manifest, description: 'Updated metadata' }));
  assert.equal(fixture.check(), null);

  fixture.write('package.json', JSON.stringify({
    ...fixture.manifest,
    exports: { './runtime': fixture.manifest.exports['./runtime'] },
  }));
  assert.deepEqual(fixture.check()?.changedSurfacePaths, ['sdks/typescript/package.json']);
  fixture.commit('Remove a public export');
  const context = fixture.check();
  assert.deepEqual(context?.changedSurfacePaths, ['sdks/typescript/package.json']);
  assert.equal(isRuntimeSurfaceVersionAdvanced(context.baseVersion, context.currentVersion), false);
});
