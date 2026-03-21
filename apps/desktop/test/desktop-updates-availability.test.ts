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
import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store';
import {
  runDesktopUpdateCheck,
  runDesktopUpdateInstall,
} from '../src/shell/renderer/infra/bootstrap/desktop-updates';

function createUnavailableReleaseInfo() {
  return {
    desktopVersion: '0.2.0',
    runtimeVersion: '0.2.0',
    channel: 'stable',
    commit: 'abc123',
    builtAt: '2026-03-15T00:00:00Z',
    runtimeReady: true,
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
  const originalGetState = useAppStore.getState;

  let banner: { kind: string; message: string } | null = null;
  let desktopUpdateCheckCalls = 0;

  desktopBridge.hasTauriInvoke = () => true;
  desktopBridge.getDesktopReleaseInfo = async () => createUnavailableReleaseInfo();
  desktopBridge.desktopUpdateCheck = async () => {
    desktopUpdateCheckCalls += 1;
    throw new Error('desktopUpdateCheck should not be called');
  };
  useAppStore.getState = (() => ({
    ...originalGetState(),
    setDesktopReleaseInfo: () => {},
    setDesktopReleaseError: () => {},
    setStatusBanner: (nextBanner: { kind: string; message: string } | null) => {
      banner = nextBanner;
    },
    setDesktopUpdateState: () => {},
  })) as typeof useAppStore.getState;

  try {
    await runDesktopUpdateCheck({ silent: false });
    assert.equal(desktopUpdateCheckCalls, 0);
    assert.deepEqual(banner, {
      kind: 'warning',
      message: 'Desktop updates are unavailable in the current environment.',
    });
  } finally {
    desktopBridge.hasTauriInvoke = originalBridge.hasTauriInvoke;
    desktopBridge.getDesktopReleaseInfo = originalBridge.getDesktopReleaseInfo;
    desktopBridge.desktopUpdateCheck = originalBridge.desktopUpdateCheck;
    useAppStore.getState = originalGetState;
  }
});

test('silent desktop update checks no-op when updater is unavailable', async () => {
  const originalBridge = {
    hasTauriInvoke: desktopBridge.hasTauriInvoke,
    getDesktopReleaseInfo: desktopBridge.getDesktopReleaseInfo,
    desktopUpdateCheck: desktopBridge.desktopUpdateCheck,
  };
  const originalGetState = useAppStore.getState;

  let bannerCalls = 0;
  let desktopUpdateCheckCalls = 0;

  desktopBridge.hasTauriInvoke = () => true;
  desktopBridge.getDesktopReleaseInfo = async () => createUnavailableReleaseInfo();
  desktopBridge.desktopUpdateCheck = async () => {
    desktopUpdateCheckCalls += 1;
    throw new Error('desktopUpdateCheck should not be called');
  };
  useAppStore.getState = (() => ({
    ...originalGetState(),
    setDesktopReleaseInfo: () => {},
    setDesktopReleaseError: () => {},
    setStatusBanner: () => {
      bannerCalls += 1;
    },
    setDesktopUpdateState: () => {},
  })) as typeof useAppStore.getState;

  try {
    await runDesktopUpdateCheck({ silent: true, autoDownload: true });
    assert.equal(desktopUpdateCheckCalls, 0);
    assert.equal(bannerCalls, 0);
  } finally {
    desktopBridge.hasTauriInvoke = originalBridge.hasTauriInvoke;
    desktopBridge.getDesktopReleaseInfo = originalBridge.getDesktopReleaseInfo;
    desktopBridge.desktopUpdateCheck = originalBridge.desktopUpdateCheck;
    useAppStore.getState = originalGetState;
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
  const originalGetState = useAppStore.getState;

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
  useAppStore.getState = (() => ({
    ...originalGetState(),
    setDesktopReleaseInfo: () => {},
    setDesktopReleaseError: () => {},
    setStatusBanner: (nextBanner: { kind: string; message: string } | null) => {
      banner = nextBanner;
    },
    setDesktopUpdateState: () => {},
  })) as typeof useAppStore.getState;

  try {
    await runDesktopUpdateInstall({ silent: false });
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
    useAppStore.getState = originalGetState;
  }
});
