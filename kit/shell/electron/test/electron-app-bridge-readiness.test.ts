import { expect, it, vi } from 'vitest';
import { registerNimiElectronAppBridge } from '../src/main/app-bridge.js';
import { FakeIpcMain } from './electron-shell-test-utils.js';
import type { NimiElectronAppBusinessServices } from '../src/main/app-business-services.js';
import type { NimiElectronLocalAppHost } from '../src/main/local-app-host.js';
import { dispatchElectronLocalAppCommand } from '../src/main/local-app-commands.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const lifecycle = vi.hoisted(() => ({
  invalidate: () => {}, ready: () => {},
  status: async (): Promise<Record<string, unknown>> => ({ state: 'ready' }),
  host: undefined as NimiElectronLocalAppHost | undefined,
}));
vi.mock('../src/main/local-app-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/local-app-host.js')>();
  return { ...actual,
    createNimiElectronLocalAppHost: (invalidate: () => void, ready: () => void) => {
      lifecycle.invalidate = invalidate; lifecycle.ready = ready;
      lifecycle.host = {
        storageReadJson: async () => ({ value: { current: true }, sizeBytes: 16 }),
        sessionStatus: () => lifecycle.status(),
      } as NimiElectronLocalAppHost;
      return lifecycle.host;
    },
    startNimiElectronLocalAppHostMaintenance: () => ({ ready: Promise.resolve(), close: () => {} }),
  };
});

it('closes renderer conversation waits on invalidation and unregister without delivering old events', async () => {
  const pending = new Map<string, (value: Record<string, unknown>) => void>();
  const closed: string[] = [];
  const sent = vi.fn();
  let streamNumber = 0;
  const bridge = registerNimiElectronAppBridge({
    appId: 'fixture.renderer-stream', allowedRendererUrls: ['app://fixture/index.html'], ipcMain: new FakeIpcMain(),
    assetMediaPlatform: { protocol: { handle: () => undefined, unhandle: () => undefined }, webRequest: { onBeforeRequest: () => undefined }, webContents: { fromId: () => undefined } },
    onSessionInvalidated: () => expect(pending.size).toBe(0),
  });
  const host = lifecycle.host!;
  Object.assign(host, {
    conversationSubscribe: async () => ({ streamId: `conversation-${++streamNumber}` }),
    conversationStreamNext: ({ streamId }: { streamId: string }) => new Promise(resolve => pending.set(streamId, resolve)),
    conversationStreamClose: async ({ streamId }: { streamId: string }) => {
      closed.push(streamId);
      pending.get(streamId)?.({ completed: false, event: { old: true } });
      pending.delete(streamId);
      return { closed: true };
    },
  });
  const subscribe = () => dispatchElectronLocalAppCommand({
    host, command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'],
    payload: { agentHandle: 'agent-1', conversationAnchorId: 'anchor-1' }, sendEvent: sent,
  });
  try {
    await subscribe();
    await vi.waitFor(() => expect(pending.has('conversation-1')).toBe(true));
    lifecycle.invalidate();
    expect(closed).toContain('conversation-1');
    await vi.waitFor(() => expect(pending.size).toBe(0));
    lifecycle.ready();
    await subscribe();
    await vi.waitFor(() => expect(pending.has('conversation-2')).toBe(true));
    bridge.unregister();
    expect(closed).toContain('conversation-2');
    await Promise.resolve();
    expect(sent).not.toHaveBeenCalled();
  } finally { bridge.unregister(); }
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
