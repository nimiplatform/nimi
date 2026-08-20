import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  getElectronStandardShellCapabilityIds,
  NimiElectronShellHostError,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type ElectronRuntimeBridgeUnaryRequest,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  STANDARD_EVENT_NAMESPACE,
  createInvokeEvent,
  fetchOkText,
  findFreePort,
  fromBase64,
  invokeBridge,
  toBase64,
  withEnvVars,
  withTempDir,
} from './electron-shell-test-utils.js';

describe('installNimiElectronRuntimeBridge', () => {
  it('exposes only a narrowed invoke/listen API through contextBridge', async () => {
    const exposed = new Map<string, unknown>();
    const ipcEvents = new Map<string, (event: unknown, payload: unknown) => void>();
    const result = installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async (channel, payload) => ({
          ok: true,
          value: { channel, payload },
        }),
        on: (channel, listener) => {
          ipcEvents.set(channel, listener);
        },
        removeListener: (channel) => {
          ipcEvents.delete(channel);
        },
      },
    });

    expect(result).toEqual({
      apiKey: '__NIMI_ELECTRON_RUNTIME__',
      invokeChannel: 'nimi:runtime:invoke',
      listenChannelPrefix: 'nimi:runtime:event:',
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
      listen: (event: string, handler: (event: { payload: unknown }) => void) => () => void;
      ipcRenderer?: unknown;
    };
    expect(Object.keys(hook).sort()).toEqual(['invoke', 'listen']);
    await expect(hook.invoke(STANDARD_COMMANDS.status, { ok: true })).resolves.toEqual({
      channel: 'nimi:runtime:invoke',
      payload: {
        command: STANDARD_COMMANDS.status,
        payload: { ok: true },
      },
    });

    const received: unknown[] = [];
    const unsubscribe = hook.listen(`${STANDARD_EVENT_NAMESPACE}:stream:abc`, (event) => {
      received.push(event.payload);
    });
    ipcEvents.get(`nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:abc`)?.({}, { eventType: 'completed' });
    expect(received).toEqual([{ eventType: 'completed' }]);
    unsubscribe();
    expect(ipcEvents.has('nimi:runtime:event:runtime_bridge:stream:abc')).toBe(false);

    const openIntentEvents: unknown[] = [];
    const unsubscribeOpenIntent = hook.listen('desktop-open://open-intent', (event) => {
      openIntentEvents.push(event.payload);
    });
    ipcEvents.get('nimi:runtime:event:desktop-open://open-intent')?.({}, { requestId: 'request-a' });
    expect(openIntentEvents).toEqual([{ requestId: 'request-a' }]);
    unsubscribeOpenIntent();

    const menuBarEvents: unknown[] = [];
    const unsubscribeMenuBar = hook.listen('menu-bar://open-tab', (event) => {
      menuBarEvents.push(event.payload);
    });
    ipcEvents.get('nimi:runtime:event:menu-bar://open-tab')?.({}, {
      tab: 'runtime',
      page: 'overview',
    });
    expect(menuBarEvents).toEqual([{ tab: 'runtime', page: 'overview' }]);
    unsubscribeMenuBar();
    expect(() => hook.listen('desktop-open:\\unsafe', () => undefined)).toThrow(/unsupported characters/u);
  });

  it('rethrows serialized standard errors with the admitted envelope shape', async () => {
    const exposed = new Map<string, unknown>();
    installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async () => ({
          ok: false,
          error: {
            name: 'NimiElectronShellHostError',
            message: 'Electron Runtime daemon is externally managed',
            code: 'external-daemon-required',
            reasonCode: 'electron-runtime-daemon-managed-externally',
            actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
            source: 'electron',
            retryable: false,
            details: { command: STANDARD_COMMANDS.start },
            envelope: {
              code: 'external-daemon-required',
              reasonCode: 'electron-runtime-daemon-managed-externally',
              actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
              source: 'electron',
              details: { command: STANDARD_COMMANDS.start },
            },
          },
        }),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
    };

    await expect(hook.invoke(STANDARD_COMMANDS.start, {})).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
      actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
      source: 'electron',
      retryable: false,
      envelope: {
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-daemon-managed-externally',
        source: 'electron',
      },
    });
  });

  it('preserves host retryability through the real preload invoke path', async () => {
    const ipcMain = new FakeIpcMain();
    const registration = registerNimiElectronRuntimeBridge({
      appId: 'acme.widget',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      commandHandlers: {
        'test.retryable-error': () => {
          throw Object.assign(new NimiElectronShellHostError({
            code: 'resource-exhausted',
            message: 'fixed request boundary exceeded',
            reasonCode: 'DESKTOP_HTTP_REQUEST_TOO_LARGE',
            actionHint: 'reduce_desktop_http_request_size',
          }), { retryable: false });
        },
      },
    });
    const { event } = createInvokeEvent();
    const exposed = new Map<string, unknown>();
    installNimiElectronRuntimeBridge({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposed.set(key, api);
        },
      },
      ipcRenderer: {
        invoke: async (channel, payload) => ipcMain.invoke(channel, event, payload),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
    const hook = exposed.get('__NIMI_ELECTRON_RUNTIME__') as {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
    };

    try {
      await expect(hook.invoke('test.retryable-error', {})).rejects.toMatchObject({
        code: 'resource-exhausted',
        reasonCode: 'DESKTOP_HTTP_REQUEST_TOO_LARGE',
        retryable: false,
      });
    } finally {
      registration.unregister();
    }
  });
});
