import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createNimiElectronStandardApplicationMenuTemplate,
  createNimiElectronFileAIConfigStore,
  getElectronStandardShellCapabilityIds,
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
      envelope: {
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-daemon-managed-externally',
        source: 'electron',
      },
    });
  });
});
