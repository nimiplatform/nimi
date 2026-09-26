import { expect, it, vi } from 'vitest';
import { registerNimiElectronAppBridge } from '../src/main/app-bridge.js';
import { FakeIpcMain } from './electron-shell-test-utils.js';
import type { NimiElectronAppBusinessServices } from '../src/main/app-business-services.js';

const lifecycle = vi.hoisted(() => ({ invalidate: () => {}, ready: () => {} }));
vi.mock('../src/main/local-app-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/local-app-host.js')>();
  return { ...actual,
    createNimiElectronLocalAppHost: (invalidate: () => void, ready: () => void) => {
      lifecycle.invalidate = invalidate; lifecycle.ready = ready;
      return { storageReadJson: async () => ({ value: { current: true }, sizeBytes: 16 }) };
    },
    startNimiElectronLocalAppHostMaintenance: () => ({ ready: Promise.resolve(), close: () => {} }),
  };
});

it('supplies services once per ready scope and permanently retires objects captured before invalidation', async () => {
  const delivered: NimiElectronAppBusinessServices[] = [];
  const invalidated = vi.fn();
  const bridge = registerNimiElectronAppBridge({
    appId: 'fixture.business', allowedRendererUrls: ['app://fixture/index.html'], ipcMain: new FakeIpcMain(),
    assetMediaPlatform: { protocol: { handle: () => undefined, unhandle: () => undefined }, webRequest: { onBeforeRequest: () => undefined }, webContents: { fromId: () => undefined } },
    onSessionInvalidated: invalidated, onSessionReady: services => delivered.push(services),
  });
  try {
    const captured = bridge.services;
    lifecycle.ready(); lifecycle.ready();
    expect(delivered).toEqual([captured]);
    lifecycle.invalidate(); lifecycle.invalidate();
    expect(invalidated).toHaveBeenCalledOnce();
    await expect(captured.storage.readJson('record.json')).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    await expect(captured.storage.writeJson('record.json', {})).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    lifecycle.ready(); lifecycle.ready();
    expect(delivered).toHaveLength(2);
    expect(bridge.services).toBe(delivered[1]);
    expect(bridge.services).not.toBe(captured);
    await expect(captured.storage.readJson('record.json')).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    await expect(bridge.services.storage.readJson('record.json')).resolves.toEqual({ value: { current: true }, sizeBytes: 16 });
  } finally { bridge.unregister(); }
});
