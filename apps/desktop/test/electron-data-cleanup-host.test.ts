import assert from 'node:assert/strict';
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

test('Electron data cleanup waits for in-flight data-root work before removing apps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-data-cleanup-gate-'));
  const dataRoot = path.join(root, 'nimi_data');
  const appsDirectory = path.join(dataRoot, 'apps');
  const operationGate = createDesktopDataRootOperationGate();
  let releaseWrite: (() => void) | undefined;
  const writeBarrier = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  try {
    await mkdir(appsDirectory, { recursive: true });
    await writeFile(path.join(appsDirectory, 'pending.db'), 'before');
    const host = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: async () => dataRoot,
      operationGate,
    });
    const inFlightWrite = operationGate.runExclusive(async () => {
      await writeBarrier;
      await writeFile(path.join(appsDirectory, 'pending.db'), 'committed');
    });
    const cleanup = host.commandHandlers.nimi_data_cleanup_execute({
      payload: { payload: { directory: 'apps', confirmation: 'CLEAN' } },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await readFile(path.join(appsDirectory, 'pending.db'), 'utf8'), 'before');
    releaseWrite?.();
    await inFlightWrite;
    const outcome = await cleanup;
    assert.equal(outcome.directory, 'apps');
    await assert.rejects(
      readFile(path.join(appsDirectory, 'pending.db')),
      /ENOENT/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
