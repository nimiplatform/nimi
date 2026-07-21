import assert from 'node:assert/strict';
import test from 'node:test';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

import { desktopBridge } from '../src/shell/renderer/bridge';
import {
  runDesktopUpdateCheck,
  runDesktopUpdateInstall,
} from '../src/shell/renderer/infra/bootstrap/desktop-updates';

type UpdatesPort = Parameters<typeof runDesktopUpdateCheck>[0];

function createUpdatesPort(
  setStatusBanner: UpdatesPort['setStatusBanner'],
): UpdatesPort {
  return {
    bootstrap: () => ({ bootstrapReady: true, bootstrapError: null }),
    desktopReleaseInfo: () => null,
    setDesktopReleaseError: () => {},
    setDesktopReleaseInfo: () => {},
    setDesktopUpdateState: () => {},
    setStatusBanner,
    subscribeBootstrap: () => () => {},
    translate: (_key, options) => String(options?.defaultValue || ''),
  };
}

function createUnavailableReleaseInfo() {
  return {
    desktopVersion: '0.2.0',
    desktopReleaseId: 'desktop-0.2.0+abc123',
    channel: 'stable',
    commit: 'abc123',
    builtAt: '2026-03-15T00:00:00Z',
    updaterAvailable: false,
    updaterUnavailableReason: 'Desktop updates are unavailable in the current environment.',
  };
}

test('runDesktopUpdateCheck short-circuits unavailable updater without invoking update IPC', async () => {
  const originalBridge = {
    hasTauriInvoke: desktopBridge.hasTauriInvoke,
    getDesktopReleaseInfo: desktopBridge.getDesktopReleaseInfo,
    desktopUpdateCheck: desktopBridge.desktopUpdateCheck,
  };
  let banner: { kind: string; message: string } | null = null;
  let desktopUpdateCheckCalls = 0;

  desktopBridge.hasTauriInvoke = () => true;
  desktopBridge.getDesktopReleaseInfo = async () => createUnavailableReleaseInfo();
  desktopBridge.desktopUpdateCheck = async () => {
    desktopUpdateCheckCalls += 1;
    throw new Error('desktopUpdateCheck should not be called');
  };
  const port = createUpdatesPort((nextBanner) => {
    banner = nextBanner;
  });

  try {
    await runDesktopUpdateCheck(port, { silent: false });
    assert.equal(desktopUpdateCheckCalls, 0);
    assert.deepEqual(banner, {
      kind: 'warning',
      message: 'Desktop updates are unavailable in the current environment.',
    });
  } finally {
    desktopBridge.hasTauriInvoke = originalBridge.hasTauriInvoke;
    desktopBridge.getDesktopReleaseInfo = originalBridge.getDesktopReleaseInfo;
    desktopBridge.desktopUpdateCheck = originalBridge.desktopUpdateCheck;
  }
});

test('silent desktop update checks no-op when updater is unavailable', async () => {
  const originalBridge = {
    hasTauriInvoke: desktopBridge.hasTauriInvoke,
    getDesktopReleaseInfo: desktopBridge.getDesktopReleaseInfo,
    desktopUpdateCheck: desktopBridge.desktopUpdateCheck,
  };
  let bannerCalls = 0;
  let desktopUpdateCheckCalls = 0;

  desktopBridge.hasTauriInvoke = () => true;
  desktopBridge.getDesktopReleaseInfo = async () => createUnavailableReleaseInfo();
  desktopBridge.desktopUpdateCheck = async () => {
    desktopUpdateCheckCalls += 1;
    throw new Error('desktopUpdateCheck should not be called');
  };
  const port = createUpdatesPort(() => {
    bannerCalls += 1;
  });

  try {
    await runDesktopUpdateCheck(port, { silent: true, autoDownload: true });
    assert.equal(desktopUpdateCheckCalls, 0);
    assert.equal(bannerCalls, 0);
  } finally {
    desktopBridge.hasTauriInvoke = originalBridge.hasTauriInvoke;
    desktopBridge.getDesktopReleaseInfo = originalBridge.getDesktopReleaseInfo;
    desktopBridge.desktopUpdateCheck = originalBridge.desktopUpdateCheck;
  }
});

test('runDesktopUpdateInstall short-circuits unavailable updater before download', async () => {
  const originalBridge = {
    hasTauriInvoke: desktopBridge.hasTauriInvoke,
    getDesktopReleaseInfo: desktopBridge.getDesktopReleaseInfo,
    getDesktopUpdateState: desktopBridge.getDesktopUpdateState,
    desktopUpdateDownload: desktopBridge.desktopUpdateDownload,
    desktopUpdateInstall: desktopBridge.desktopUpdateInstall,
  };
  let banner: { kind: string; message: string } | null = null;
  let downloadCalls = 0;
  let installCalls = 0;

  desktopBridge.hasTauriInvoke = () => true;
  desktopBridge.getDesktopReleaseInfo = async () => createUnavailableReleaseInfo();
  desktopBridge.getDesktopUpdateState = async () => ({
    status: 'idle',
    currentVersion: '0.2.0',
    downloadedBytes: 0,
    readyToRestart: false,
  });
  desktopBridge.desktopUpdateDownload = async () => {
    downloadCalls += 1;
    throw new Error('desktopUpdateDownload should not be called');
  };
  desktopBridge.desktopUpdateInstall = async () => {
    installCalls += 1;
    throw new Error('desktopUpdateInstall should not be called');
  };
  const port = createUpdatesPort((nextBanner) => {
    banner = nextBanner;
  });

  try {
    await runDesktopUpdateInstall(port, { silent: false });
    assert.equal(downloadCalls, 0);
    assert.equal(installCalls, 0);
    assert.deepEqual(banner, {
      kind: 'warning',
      message: 'Desktop updates are unavailable in the current environment.',
    });
  } finally {
    desktopBridge.hasTauriInvoke = originalBridge.hasTauriInvoke;
    desktopBridge.getDesktopReleaseInfo = originalBridge.getDesktopReleaseInfo;
    desktopBridge.getDesktopUpdateState = originalBridge.getDesktopUpdateState;
    desktopBridge.desktopUpdateDownload = originalBridge.desktopUpdateDownload;
    desktopBridge.desktopUpdateInstall = originalBridge.desktopUpdateInstall;
  }
});
