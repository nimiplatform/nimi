import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

function waitForOutput(stream, expected) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      if (!String(chunk).includes(expected)) return;
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('error', onError);
    };
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('SDK dist lock runner does not use deprecated shell args on Windows', () => {
  const lockDir = path.join(os.tmpdir(), `nimi-package-build-runner-lock-${process.pid}-${Date.now()}`);
  const result = runSdkDistLock(lockDir);

  assertSuccessful(result);
  assert.equal(result.stdout, 'locked');
});

test('root build holds the workspace surface lock across consumer builds', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts.build,
    'node scripts/with-workspace-surfaces.mjs -- pnpm run build:prepared',
  );
  assert.equal(
    packageJson.scripts['build:prepared'],
    'pnpm build:install-gateway && pnpm --filter @nimiplatform/desktop build && pnpm --filter @nimiplatform/web build && pnpm --filter @nimiplatform/lab build',
  );
  assert.equal(
    packageJson.scripts['build:all'],
    'node scripts/with-workspace-surfaces.mjs -- pnpm --recursive --filter=!@nimiplatform/sdk --filter=!@nimiplatform/kit build',
  );
});

test('SDK adapter builds consume one prepared workspace surface', () => {
  for (const adapter of ['mastra', 'vercel-ai']) {
    const packageJson = JSON.parse(readFileSync(
      path.join(repoRoot, 'sdks', 'typescript', 'adapters', adapter, 'package.json'),
      'utf8',
    ));
    assert.equal(
      packageJson.scripts.build,
      'node ../../../../scripts/with-workspace-surfaces.mjs -- pnpm run build:prepared',
    );
    assert.equal(
      packageJson.scripts['build:prepared'],
      'node ../../../../scripts/build-typescript-package.mjs --tsconfig tsconfig.build.json --out-dir dist',
    );
  }
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
    mkdirSync(path.join(tempRoot, 'dist'));
    writeFileSync(path.join(tempRoot, 'src', 'index.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(tempRoot, 'dist', 'stale.js'), 'export const stale = true;\n');
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
    assert.equal(existsSync(path.join(tempRoot, 'dist', 'index.js')), true);
    assert.equal(existsSync(path.join(tempRoot, 'dist', 'stale.js')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('TypeScript package build runner publishes while a consumer holds the output directory', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-package-build-runner-live-consumer-'));
  const distRoot = path.join(tempRoot, 'dist');
  let consumer;
  try {
    mkdirSync(path.join(tempRoot, 'src'));
    mkdirSync(distRoot);
    writeFileSync(path.join(tempRoot, 'src', 'index.ts'), 'export const value = 2;\n');
    writeFileSync(path.join(distRoot, 'stale.js'), 'export const stale = true;\n');
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

    consumer = spawn(
      process.execPath,
      ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
      { cwd: distRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await waitForOutput(consumer.stdout, 'ready');

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
    assert.equal(existsSync(path.join(distRoot, 'index.js')), true);
    assert.equal(existsSync(path.join(distRoot, 'stale.js')), false);
  } finally {
    if (consumer && consumer.exitCode === null) {
      const exited = new Promise((resolve) => consumer.once('exit', resolve));
      consumer.kill();
      await exited;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('TypeScript package build runner preserves the previous output when compilation fails', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-package-build-runner-failure-'));
  try {
    mkdirSync(path.join(tempRoot, 'src'));
    mkdirSync(path.join(tempRoot, 'dist'));
    writeFileSync(path.join(tempRoot, 'src', 'index.ts'), 'export const value: string = 1;\n');
    writeFileSync(path.join(tempRoot, 'dist', 'index.js'), 'export const value = "last-success";\n');
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

    assert.equal(result.status, 1);
    assert.match(result.stderr, /tsc failed for/);
    assert.equal(
      readFileSync(path.join(tempRoot, 'dist', 'index.js'), 'utf8'),
      'export const value = "last-success";\n',
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
