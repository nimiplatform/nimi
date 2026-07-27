import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sdkRoot = path.join(repoRoot, 'sdks', 'typescript');

function envWithThrowDeprecation() {
  return envWithThrowDeprecationOverrides({});
}

function envWithThrowDeprecationOverrides(overrides) {
  const current = String(process.env.NODE_OPTIONS || '').trim();
  return {
    ...process.env,
    NODE_OPTIONS: current ? `${current} --throw-deprecation` : '--throw-deprecation',
    ...overrides,
  };
}

function assertSuccessful(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  assert.equal(result.status, 0, output);
  assert.equal(result.error, undefined, output);
  assert.doesNotMatch(output, /DEP0190/);
}

function sdkDistLockEnv(lockDir) {
  const env = envWithThrowDeprecationOverrides({
    NIMI_SDK_DIST_LOCK_DIR: lockDir,
    NIMI_SDK_DIST_LOCK_POLL_MS: '10',
    NIMI_SDK_DIST_LOCK_STALE_MS: '60000',
    NIMI_SDK_DIST_LOCK_TIMEOUT_MS: '100',
    NIMI_SDK_DIST_LOCK_WAIT_LOG_MS: '60000',
  });
  delete env.NIMI_SDK_DIST_LOCK_TOKEN;
  return env;
}

function runSdkDistLock(lockDir) {
  return spawnSync(
    process.execPath,
    [
      'scripts/with-sdk-dist-lock.mjs',
      '--',
      process.execPath,
      '-e',
      'process.stdout.write("locked")',
    ],
    {
      cwd: repoRoot,
      env: sdkDistLockEnv(lockDir),
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

test('SDK dist lock runner does not use deprecated shell args on Windows', () => {
  const lockDir = path.join(os.tmpdir(), `nimi-package-build-runner-lock-${process.pid}-${Date.now()}`);
  const result = runSdkDistLock(lockDir);

  assertSuccessful(result);
  assert.equal(result.stdout, 'locked');
});

test('SDK dist lock immediately reclaims a fresh lock owned by a dead process', () => {
  const lockDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-dist-dead-owner-'));
  const exitedChild = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(exitedChild.status, 0);
  assert.ok(Number.isInteger(exitedChild.pid));
  writeFileSync(
    path.join(lockDir, 'owner.json'),
    `${JSON.stringify({ token: 'dead-owner', label: 'dead owner', pid: exitedChild.pid })}\n`,
  );

  try {
    const result = runSdkDistLock(lockDir);
    assertSuccessful(result);
    assert.equal(result.stdout, 'locked');
    assert.equal(existsSync(lockDir), false);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test('SDK dist lock preserves a fresh lock without an owner', () => {
  const lockDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-dist-no-owner-'));
  try {
    const result = runSdkDistLock(lockDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /timed out waiting for SDK dist lock/);
    assert.equal(existsSync(lockDir), true);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test('SDK dist lock preserves a lock owned by a live process', () => {
  const lockDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-dist-live-owner-'));
  writeFileSync(
    path.join(lockDir, 'owner.json'),
    `${JSON.stringify({ token: 'live-owner', label: 'live owner', pid: process.pid })}\n`,
  );

  try {
    const result = runSdkDistLock(lockDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /timed out waiting for SDK dist lock/);
    assert.equal(existsSync(lockDir), true);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test('TypeScript package build runner does not use deprecated shell args on Windows', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-package-build-runner-'));
  try {
    mkdirSync(path.join(tempRoot, 'src'));
    writeFileSync(path.join(tempRoot, 'src', 'index.ts'), 'export const value = 1;\n');
    writeFileSync(
      path.join(tempRoot, 'tsconfig.json'),
      `${JSON.stringify({
        compilerOptions: {
          declaration: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          target: 'ES2022',
        },
        include: ['src/**/*.ts'],
      }, null, 2)}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts/build-typescript-package.mjs'),
        '--tsconfig',
        'tsconfig.json',
        '--out-dir',
        'dist',
        '--tsc-cwd',
        sdkRoot,
      ],
      {
        cwd: tempRoot,
        env: envWithThrowDeprecation(),
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    assertSuccessful(result);
    assert.match(result.stdout, /\[build-typescript-package\] built dist/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
