import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createDesktopElectronDataCleanupHost,
} from '../src-electron/data-cleanup-host.js';
import { createDesktopDataRootOperationGate } from '../src-electron/data-root-operation-gate.js';

test('Electron data cleanup plans impact and requires CLEAN before deleting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-'));
  const dataRoot = path.join(root, 'nimi_data');
  const logsDirectory = path.join(dataRoot, 'logs');
  try {
    await mkdir(path.join(logsDirectory, 'runtime'), { recursive: true });
    await writeFile(path.join(logsDirectory, 'desktop.log'), 'desktop');
    await writeFile(path.join(logsDirectory, 'runtime', 'runtime.log'), 'runtime');
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
    });

    const plan = await host.commandHandlers.nimi_data_cleanup_plan({
      payload: { directory: 'logs' },
    });
    assert.deepEqual(plan, {
      directory: 'logs',
      owner: 'runtime_product_support',
      cleanupClass: 'confirm_required',
      totalBytes: Buffer.byteLength('desktop') + Buffer.byteLength('runtime'),
      fileCount: 2,
      requiresConfirmation: true,
      runtimeOwnerBlocked: false,
    });
    assert.equal(await readFile(path.join(logsDirectory, 'desktop.log'), 'utf8'), 'desktop');

    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_execute({
        payload: { payload: { directory: 'logs', confirmation: null } },
      }),
      /desktop-data-cleanup-confirmation-required/u,
    );
    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_execute({
        payload: { payload: { directory: 'logs', confirmation: 'clean' } },
      }),
      /desktop-data-cleanup-confirmation-required/u,
    );
    assert.equal(await readFile(path.join(logsDirectory, 'desktop.log'), 'utf8'), 'desktop');

    const outcome = await host.commandHandlers.nimi_data_cleanup_execute({
      payload: { payload: { directory: 'logs', confirmation: 'CLEAN' } },
    });
    assert.deepEqual(outcome, {
      directory: 'logs',
      removedBytes: plan.totalBytes,
      removedFiles: plan.fileCount,
    });
    const cleaned = await lstat(logsDirectory);
    assert.equal(cleaned.isDirectory(), true);
    await assert.rejects(readFile(path.join(logsDirectory, 'desktop.log')), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron data cleanup exposes Runtime ownership but refuses direct deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-runtime-'));
  const dataRoot = path.join(root, 'nimi_data');
  try {
    await mkdir(path.join(dataRoot, 'models'), { recursive: true });
    await writeFile(path.join(dataRoot, 'models', 'model.bin'), 'model');
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
    });

    const plan = await host.commandHandlers.nimi_data_cleanup_plan({
      payload: { directory: 'models' },
    });
    assert.equal(plan.runtimeOwnerBlocked, true);
    assert.equal(plan.cleanupClass, 'runtime_managed');
    assert.equal(plan.fileCount, 1);
    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_execute({
        payload: { payload: { directory: 'models', confirmation: 'CLEAN' } },
      }),
      /desktop-data-cleanup-runtime-owner-blocked/u,
    );
    assert.equal(await readFile(path.join(dataRoot, 'models', 'model.bin'), 'utf8'), 'model');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron data cleanup previews apps and accounts but never deletes them, even with CLEAN', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-owner-'));
  const dataRoot = path.join(root, 'nimi_data');
  const sentinels = [
    path.join(dataRoot, 'apps', 'local-app-kernel.db'),
    path.join(dataRoot, 'apps', 'packages', 'releases', 'release.bin'),
    // An installed Electron package archive counts as the one file it is.
    path.join(dataRoot, 'apps', 'packages', 'releases', 'payload', 'resources', 'app.asar'),
    path.join(dataRoot, 'accounts', 'runtime', 'local-state.json'),
  ];
  try {
    for (const sentinel of sentinels) {
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, `owner:${path.basename(sentinel)}`);
    }
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
    });
    const bytes = (...names: string[]) => names.reduce((sum, name) => sum + `owner:${name}`.length, 0);
    for (const [directory, owner, fileCount, totalBytes] of [
      ['apps', 'app_package_installer', 3, bytes('local-app-kernel.db', 'release.bin', 'app.asar')],
      ['accounts', 'account_data_plane_consumers', 1, bytes('local-state.json')],
    ] as const) {
      const plan = await host.commandHandlers.nimi_data_cleanup_plan({ payload: { directory } });
      assert.equal(plan.owner, owner);
      assert.equal(plan.cleanupClass, 'owner_managed');
      assert.equal(plan.runtimeOwnerBlocked, true);
      assert.equal(plan.fileCount, fileCount);
      assert.equal(plan.totalBytes, totalBytes);
      await assert.rejects(
        host.commandHandlers.nimi_data_cleanup_execute({
          payload: { payload: { directory, confirmation: 'CLEAN' } },
        }),
        /desktop-data-cleanup-runtime-owner-blocked/u,
      );
    }
    for (const sentinel of sentinels) {
      assert.equal(await readFile(sentinel, 'utf8'), `owner:${path.basename(sentinel)}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron data cleanup rejects undeclared paths and non-exact IPC payloads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-ipc-'));
  const dataRoot = path.join(root, 'nimi_data');
  try {
    await mkdir(path.join(dataRoot, 'logs'), { recursive: true });
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
    });

    for (const directory of ['', 'logs/', ' logs', '../logs', 'cache', 1]) {
      await assert.rejects(
        host.commandHandlers.nimi_data_cleanup_plan({ payload: { directory } }),
        /desktop-data-cleanup-directory-invalid/u,
      );
    }
    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_plan({
        payload: { directory: 'logs', dataRoot: '/' },
      }),
      /desktop-data-cleanup-plan-payload-invalid/u,
    );
    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_execute({
        payload: { directory: 'logs', confirmation: 'CLEAN' },
      }),
      /desktop-data-cleanup-execute-payload-invalid/u,
    );
    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_execute({
        payload: {
          payload: {
            directory: 'logs',
            confirmation: 'CLEAN',
            target: '/',
          },
        },
      }),
      /desktop-data-cleanup-execute-payload-invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron data cleanup rejects symbolic links inside an allowed directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-link-'));
  const dataRoot = path.join(root, 'nimi_data');
  const outside = path.join(root, 'outside.txt');
  try {
    await mkdir(path.join(dataRoot, 'logs'), { recursive: true });
    await writeFile(outside, 'outside');
    try {
      await symlink(outside, path.join(dataRoot, 'logs', 'outside.log'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('symbolic link creation is not permitted on this host');
        return;
      }
      throw error;
    }
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
    });

    await assert.rejects(
      host.commandHandlers.nimi_data_cleanup_plan({ payload: { directory: 'logs' } }),
      /desktop-data-cleanup-symbolic-link-rejected/u,
    );
    assert.equal(await readFile(outside, 'utf8'), 'outside');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron data cleanup waits for in-flight data-root work before removing logs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-gate-'));
  const dataRoot = path.join(root, 'nimi_data');
  const gatedDirectory = path.join(dataRoot, 'logs');
  const operationGate = createDesktopDataRootOperationGate();
  let releaseWrite: (() => void) | undefined;
  const writeBarrier = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  try {
    await mkdir(gatedDirectory, { recursive: true });
    await writeFile(path.join(gatedDirectory, 'pending.db'), 'before');
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
      operationGate,
    });
    const inFlightWrite = operationGate.runExclusive(async () => {
      await writeBarrier;
      await writeFile(path.join(gatedDirectory, 'pending.db'), 'committed');
    });
    const cleanup = host.commandHandlers.nimi_data_cleanup_execute({
      payload: { payload: { directory: 'logs', confirmation: 'CLEAN' } },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await readFile(path.join(gatedDirectory, 'pending.db'), 'utf8'), 'before');
    releaseWrite?.();
    await inFlightWrite;
    const outcome = await cleanup;
    assert.equal(outcome.directory, 'logs');
    await assert.rejects(
      readFile(path.join(gatedDirectory, 'pending.db')),
      /ENOENT/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('data-root operation gate keeps queued work closed after a committed handoff failure', async () => {
  const gate = createDesktopDataRootOperationGate();
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const active = gate.runExclusive(async () => {
    markStarted?.();
    await barrier;
  });
  await started;
  const queued = gate.runExclusive(async () => 'queued');
  gate.close('replacement-restart-failed');
  release?.();
  await active;
  await assert.rejects(queued, /replacement-restart-failed/u);
  assert.equal(gate.isClosed(), true);
  gate.open();
  assert.equal(await gate.runExclusive(async () => 'reopened'), 'reopened');
});

async function writeProfileFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

test('standard App cache clears only fixed cache classes of stopped App profiles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-app-host-cache-'));
  const scope = path.join(root, 'nimi_data', 'app-hosts', '0123456789abcdef0123456789abcdef');
  const profile = path.join(scope, 'apps', 'fedcba9876543210fedcba9876543210');
  const sessionData = path.join(profile, 'session-data');
  const preserved = [
    path.join(sessionData, 'Cookies'),
    path.join(sessionData, 'Local Storage', 'leveldb', '000003.log'),
    path.join(sessionData, 'IndexedDB', 'app.indexeddb.leveldb', 'CURRENT'),
    path.join(sessionData, 'Service Worker', 'CacheStorage', 'index'),
    path.join(profile, 'user-data', 'Preferences'),
    path.join(scope, 'desktop', 'session-data', 'Cache', 'Cache_Data', 'home-entry'),
    path.join(scope, 'apps', 'not-a-profile', 'session-data', 'Cache', 'entry'),
  ];
  const cleared = [
    path.join(sessionData, 'Cache', 'Cache_Data', 'f_000001'),
    path.join(sessionData, 'Code Cache', 'js', 'index'),
    path.join(sessionData, 'GPUCache', 'data_0'),
    path.join(sessionData, 'DawnGraphiteCache', 'data_1'),
    path.join(sessionData, 'DawnWebGPUCache', 'data_2'),
  ];
  try {
    for (const filePath of [...preserved, ...cleared]) await writeProfileFile(filePath, `bytes:${path.basename(filePath)}`);
    let running = true;
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => path.join(root, 'nimi_data'),
      resolveHostProfileScope: async () => scope,
      hasActiveManagedApps: async () => running,
    });

    const plan = await host.commandHandlers.nimi_app_host_cache_plan({ payload: {} });
    assert.equal(plan.profileCount, 1);
    assert.equal(plan.fileCount, cleared.length);
    assert.equal(plan.hostsRunning, true);
    await assert.rejects(
      host.commandHandlers.nimi_app_host_cache_execute({ payload: {} }),
      /desktop-app-host-cache-hosts-running/u,
    );
    for (const filePath of cleared) assert.equal(await readFile(filePath, 'utf8'), `bytes:${path.basename(filePath)}`);

    running = false;
    const outcome = await host.commandHandlers.nimi_app_host_cache_execute({ payload: {} });
    assert.deepEqual(outcome, {
      removedBytes: plan.totalBytes,
      removedFiles: cleared.length,
      failedEntries: 0,
      complete: true,
    });
    for (const filePath of cleared) await assert.rejects(readFile(filePath), /ENOENT/u);
    for (const filePath of preserved) assert.equal(await readFile(filePath, 'utf8'), `bytes:${path.basename(filePath)}`);
    await assert.rejects(
      host.commandHandlers.nimi_app_host_cache_plan({ payload: { scope: '/' } }),
      /desktop-app-host-cache-payload-invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('standard App cache fails closed without a Runtime scope and never follows links', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-app-host-cache-link-'));
  const scope = path.join(root, 'nimi_data', 'app-hosts', '0123456789abcdef0123456789abcdef');
  const sessionData = path.join(scope, 'apps', 'fedcba9876543210fedcba9876543210', 'session-data');
  const outside = path.join(root, 'outside');
  try {
    await writeProfileFile(path.join(outside, 'keep.bin'), 'outside');
    await mkdir(sessionData, { recursive: true });
    try {
      await symlink(outside, path.join(sessionData, 'Cache'), 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('directory links are not permitted on this host');
        return;
      }
      throw error;
    }
    const unavailable = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => path.join(root, 'nimi_data'),
      resolveHostProfileScope: async () => { throw new Error('desktop-product-control-host-profile-scope-unavailable'); },
      hasActiveManagedApps: async () => false,
    });
    await assert.rejects(
      unavailable.commandHandlers.nimi_app_host_cache_execute({ payload: {} }),
      /desktop-app-host-cache-scope-unavailable/u,
    );
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => path.join(root, 'nimi_data'),
      resolveHostProfileScope: async () => scope,
      hasActiveManagedApps: async () => false,
    });
    const outcome = await host.commandHandlers.nimi_app_host_cache_execute({ payload: {} });
    assert.equal(outcome.removedFiles, 0);
    assert.equal(await readFile(path.join(outside, 'keep.bin'), 'utf8'), 'outside');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache inspection errors are not reported as an empty successful cleanup', async (t) => {
  const fsPromises = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-cache-permission-'));
  const scope = path.join(root, 'app-hosts', 'a'.repeat(32));
  const sessionData = path.join(scope, 'apps', 'b'.repeat(32), 'session-data');
  const cache = path.join(sessionData, 'Cache', 'entry');
  await writeProfileFile(cache, 'keep on inspection failure');
  const original = fsPromises.lstat;
  const intercepted = t.mock.method(fsPromises, 'lstat', (...args: Parameters<typeof original>) => {
    if (String(args[0]) === sessionData) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }));
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => root,
      resolveHostProfileScope: async () => scope,
      hasActiveManagedApps: async () => false,
    });
    await assert.rejects(host.commandHandlers.nimi_app_host_cache_execute({ payload: {} }), { code: 'EACCES' });
    assert.equal(await readFile(cache, 'utf8'), 'keep on inspection failure');
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test('a real Windows sharing lock yields incomplete cache cleanup and preserves site data', {
  skip: process.platform !== 'win32', timeout: 20_000,
}, async () => {
  const parent = fileURLToPath(new URL('../../../.nimi/local/tmp/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'cache-sharing-lock-'));
  const scope = path.join(root, 'app-hosts', 'a'.repeat(32));
  const sessionData = path.join(scope, 'apps', 'b'.repeat(32), 'session-data');
  const locked = path.join(sessionData, 'Cache', 'locked.bin');
  const persistent = path.join(sessionData, 'Local Storage', 'keep');
  await writeProfileFile(locked, 'locked cache');
  await writeProfileFile(path.join(sessionData, 'GPUCache', 'clearable'), 'clearable cache');
  await writeProfileFile(persistent, 'persistent site state');
  // Native OS file sharing, not mocked fs.rm/EACCES. This helper owns only an
  // isolated fixture file and exits when stdin closes.
  const script = `$ErrorActionPreference='Stop'; $stream=[IO.File]::Open('${locked.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $stream.Dispose() }`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cache sharing-lock helper timed out')), 8_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`lock helper exited before readiness: ${code}`)); });
      child.stdout.on('data', (data) => {
        if (String(data).includes('locked')) { clearTimeout(timer); resolve(); }
      });
    });
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => root,
      resolveHostProfileScope: async () => scope,
      hasActiveManagedApps: async () => false,
    });
    const outcome = await host.commandHandlers.nimi_app_host_cache_execute({ payload: {} });
    assert.equal(outcome.complete, false);
    assert.equal(outcome.failedEntries, 1);
    assert.equal(outcome.removedFiles, 1, 'other fixed caches can be cleared');
    assert.equal((await lstat(locked)).isFile(), true);
    assert.equal(await readFile(persistent, 'utf8'), 'persistent site state');
  } finally {
    child.stdin.end();
    await exited;
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(parent) + path.sep), 'fixture cleanup stays in its workspace parent');
    await rm(resolved, { recursive: true, force: true });
  }
});
