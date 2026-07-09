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
  NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
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

describe('registerNimiElectronRuntimeBridge', () => {
  it('proxies unary Runtime calls through raw gRPC bytes with app metadata', async () => {
    let capturedMethod = '';
    let capturedBytes = new Uint8Array();
    let capturedMetadata: Record<string, string> = {};
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMethod = request.methodId;
        capturedBytes = request.requestBytes;
        capturedMetadata = request.metadata;
        return {
          responseBytes: Uint8Array.from([4, 5, 6]),
          responseMetadata: { 'x-nimi-runtime-version': '0.5.0' },
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
      trustedRuntimeMetadataProvider: async () => ({
        protectedAccessToken: { tokenId: 'token-id', secret: 'token-secret' },
        appSession: { sessionId: 'session-id', sessionToken: 'session-token' },
      }),
    });
    const { event } = createInvokeEvent();
    const request: ElectronRuntimeBridgeUnaryRequest = {
      methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
      requestBytesBase64: toBase64(Uint8Array.from([1, 2, 3])),
      metadata: {
        protocolVersion: '1.0.0',
        extra: { 'x-nimi-custom': 'custom-value' },
      },
    };

    const response = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.unary,
      payload: request,
    }) as { responseBytesBase64: string; responseMetadata: Record<string, string> };

    expect(capturedMethod).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect([...capturedBytes]).toEqual([1, 2, 3]);
    expect(capturedMetadata).toMatchObject({
      'x-nimi-protocol-version': '1.0.0',
      'x-nimi-app-id': 'nimi.tester',
      'x-nimi-caller-kind': 'third-party-app',
      'x-nimi-access-token-id': 'token-id',
      'x-nimi-access-token-secret': 'token-secret',
      'x-nimi-session-id': 'session-id',
      'x-nimi-session-token': 'session-token',
    });
    expect(capturedMetadata['x-nimi-idempotency-key']).toMatch(/^bridge-_nimi\.runtime\.v1\.RuntimeAuditService_GetRuntimeHealth-\d+-\d+$/);
    expect(capturedMetadata['x-nimi-custom']).toBe('custom-value');
    expect([...fromBase64(response.responseBytesBase64)]).toEqual([4, 5, 6]);
    expect(response.responseMetadata['x-nimi-runtime-version']).toBe('0.5.0');
  });

  it('refreshes trusted Runtime metadata once when a protected app grant is invalidated', async () => {
    const capturedTokens: string[] = [];
    let unaryCalls = 0;
    let invalidatedReason = '';
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        unaryCalls += 1;
        capturedTokens.push(request.metadata['x-nimi-access-token-id'] || '');
        if (unaryCalls === 1) {
          throw Object.assign(new Error('7 PERMISSION_DENIED: {"reasonCode":"APP_GRANT_INVALID","actionHint":"refresh_authorization_policy"}'), {
            code: 7,
          });
        }
        return {
          responseBytes: Uint8Array.from([7, 8, 9]),
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    let metadataCalls = 0;
    const provider: ElectronRuntimeBridgeTrustedMetadataProvider = async () => {
      metadataCalls += 1;
      return {
        protectedAccessToken: {
          tokenId: metadataCalls === 1 ? 'stale-token' : 'fresh-token',
          secret: 'token-secret',
        },
        appSession: { sessionId: 'session-id', sessionToken: 'session-token' },
      };
    };
    Object.defineProperty(provider, 'invalidate', {
      value: (reason: string) => {
        invalidatedReason = reason;
      },
    });
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
      trustedRuntimeMetadataProvider: provider,
    });

    const response = await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAgentService/GetSessionSnapshot',
        requestBytesBase64: toBase64(Uint8Array.from([1])),
      },
    }) as { responseBytesBase64: string };

    expect([...fromBase64(response.responseBytesBase64)]).toEqual([7, 8, 9]);
    expect(unaryCalls).toBe(2);
    expect(metadataCalls).toBe(2);
    expect(invalidatedReason).toBe('APP_GRANT_INVALID');
    expect(capturedTokens).toEqual(['stale-token', 'fresh-token']);
  });

  it('uses host trusted Runtime identity metadata ahead of renderer metadata', async () => {
    let capturedMetadata: Record<string, string> = {};
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMetadata = request.metadata;
        return {
          responseBytes: Uint8Array.from([4, 5, 6]),
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
      trustedRuntimeMetadataProvider: async () => ({
        metadata: {
          participantId: 'nimi.desktop',
          callerKind: 'desktop-core',
          callerId: 'desktop.product-control',
          surfaceId: 'desktop.product-control',
        },
      }),
    });

    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
        requestBytesBase64: '',
        metadata: {
          surfaceId: 'renderer-spoofed-surface',
        },
      },
    });

    expect(capturedMetadata).toMatchObject({
      'x-nimi-participant-id': 'nimi.desktop',
      'x-nimi-caller-kind': 'desktop-core',
      'x-nimi-caller-id': 'desktop.product-control',
      'x-nimi-surface-id': 'desktop.product-control',
    });
  });

  it('accepts SDK electron-ipc Runtime payloads passed through the preload invoke hook', async () => {
    let capturedMethod = '';
    let capturedBytes = new Uint8Array();
    let capturedMetadata: Record<string, string> = {};
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMethod = request.methodId;
        capturedBytes = request.requestBytes;
        capturedMetadata = request.metadata;
        return {
          responseBytes: Uint8Array.from([7, 8, 9]),
        };
      },
      serverStream: () => {
        throw new Error('not used');
      },
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    const { event } = createInvokeEvent();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
    });
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

    const response = await hook.invoke(STANDARD_COMMANDS.unary, {
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: toBase64(Uint8Array.from([1, 2, 3])),
      },
    }) as { responseBytesBase64: string };

    expect(capturedMethod).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect([...capturedBytes]).toEqual([1, 2, 3]);
    expect(capturedMetadata['x-nimi-idempotency-key']).toMatch(/^bridge-_nimi\.runtime\.v1\.RuntimeAuditService_GetRuntimeHealth-\d+-\d+$/);
    expect([...fromBase64(response.responseBytesBase64)]).toEqual([7, 8, 9]);
  });

  it('fails closed for disallowed renderer origins and daemon lifecycle ownership', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent('https://evil.invalid').event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-origin-not-allowed',
    });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.start,
      payload: {},
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-daemon-managed-externally',
    });
    expect(createElectronExternalDaemonRequiredError(STANDARD_COMMANDS.restart).code).toBe('external-daemon-required');
    expect(createElectronExternalDaemonRequiredError(STANDARD_COMMANDS.restart).reasonCode).toBe('electron-runtime-daemon-managed-externally');
  });

  it('does not treat wildcard origins as an explicit renderer allowlist', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['*'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent('https://evil.invalid').event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-origin-not-allowed',
    });
  });
});
