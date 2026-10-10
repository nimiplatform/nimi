import { expect, it, vi } from 'vitest';
import { registerNimiElectronAppBridge } from '../src/main/app-bridge.js';
import { FakeIpcMain } from './electron-shell-test-utils.js';
import type { NimiElectronAppBusinessServices } from '../src/main/app-business-services.js';

const lifecycle = vi.hoisted(() => ({
  invalidate: () => {}, ready: () => {},
  status: async (): Promise<Record<string, unknown>> => ({ state: 'ready' }),
}));
vi.mock('../src/main/local-app-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/local-app-host.js')>();
  return { ...actual,
    createNimiElectronLocalAppHost: (invalidate: () => void, ready: () => void) => {
      lifecycle.invalidate = invalidate; lifecycle.ready = ready;
      return {
        storageReadJson: async () => ({ value: { current: true }, sizeBytes: 16 }),
        sessionStatus: () => lifecycle.status(),
      };
    },
    startNimiElectronLocalAppHostMaintenance: () => ({ ready: Promise.resolve(), close: () => {} }),
  };
});

it('prepares new Node work on the same Host while retired business services stay closed', async () => {
  const delivered: NimiElectronAppBusinessServices[] = [];
  const bridge = registerNimiElectronAppBridge({
    appId: 'fixture.node-work', allowedRendererUrls: ['app://fixture/index.html'], ipcMain: new FakeIpcMain(),
    assetMediaPlatform: { protocol: { handle: () => undefined, unhandle: () => undefined }, webRequest: { onBeforeRequest: () => undefined }, webContents: { fromId: () => undefined } },
    onSessionReady: services => delivered.push(services),
  });
  try {
    lifecycle.ready();
    const retired = bridge.services;
    lifecycle.invalidate();
    lifecycle.status = async () => { lifecycle.ready(); return { state: 'ready' }; };
    await bridge.prepareSession();
    expect(delivered).toHaveLength(2);
    expect(bridge.services).not.toBe(retired);
    await expect(retired.storage.readJson('record.json')).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    await expect(bridge.services.storage.readJson('record.json')).resolves.toEqual({ value: { current: true }, sizeBytes: 16 });
  } finally { bridge.unregister(); }
  await expect(bridge.prepareSession()).rejects.toMatchObject({ reasonCode: 'session-invalid' });
});

it('refuses canceled, unavailable or closed preparation without admitting business work', async () => {
  const bridge = registerNimiElectronAppBridge({
    appId: 'fixture.node-cancel', allowedRendererUrls: ['app://fixture/index.html'], ipcMain: new FakeIpcMain(),
    assetMediaPlatform: { protocol: { handle: () => undefined, unhandle: () => undefined }, webRequest: { onBeforeRequest: () => undefined }, webContents: { fromId: () => undefined } },
  });
  try {
    const controller = new AbortController(); controller.abort();
    const status = vi.fn(async () => ({ state: 'runtime-unavailable', reasonCode: 'runtime-service-unavailable', retryable: true }));
    lifecycle.status = status;
    await expect(bridge.prepareSession(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(status).not.toHaveBeenCalled();
    await expect(bridge.prepareSession()).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable', retryable: true });
    let settle!: (value: Record<string, unknown>) => void;
    lifecycle.status = () => new Promise(resolve => { settle = resolve; });
    const pending = bridge.prepareSession();
    bridge.unregister();
    settle({ state: 'ready' });
    await expect(pending).rejects.toMatchObject({ reasonCode: 'session-invalid' });
  } finally { bridge.unregister(); }
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
