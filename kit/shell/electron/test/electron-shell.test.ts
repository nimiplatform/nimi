import { describe, expect, it } from 'vitest';
import {
  createElectronExternalDaemonRequiredError,
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeUnaryRequest,
  type NimiElectronIpcMain,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';

class FakeIpcMain implements NimiElectronIpcMain {
  readonly handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown> | unknown>();

  handle(channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown> | unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, event: unknown, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`missing handler: ${channel}`);
    }
    return Promise.resolve(handler(event, payload));
  }
}

function createInvokeEvent(origin = 'http://localhost:1430') {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    event: {
      senderFrame: { origin },
      sender: {
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload });
        },
      },
    },
    sent,
  };
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

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
        invoke: async (channel, payload) => ({ channel, payload }),
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
    await expect(hook.invoke('runtime_bridge_status', { ok: true })).resolves.toEqual({
      channel: 'nimi:runtime:invoke',
      payload: {
        command: 'runtime_bridge_status',
        payload: { ok: true },
      },
    });

    const received: unknown[] = [];
    const unsubscribe = hook.listen('runtime_bridge:stream:abc', (event) => {
      received.push(event.payload);
    });
    ipcEvents.get('nimi:runtime:event:runtime_bridge:stream:abc')?.({}, { eventType: 'completed' });
    expect(received).toEqual([{ eventType: 'completed' }]);
    unsubscribe();
    expect(ipcEvents.has('nimi:runtime:event:runtime_bridge:stream:abc')).toBe(false);
  });
});

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

    const response = await ipcMain.invoke('nimi:runtime:invoke', event, {
      command: 'runtime_bridge_unary',
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
    expect(capturedMetadata['x-nimi-custom']).toBe('custom-value');
    expect([...fromBase64(response.responseBytesBase64)]).toEqual([4, 5, 6]);
    expect(response.responseMetadata['x-nimi-runtime-version']).toBe('0.5.0');
  });

  it('accepts SDK electron-ipc Runtime payloads passed through the preload invoke hook', async () => {
    let capturedMethod = '';
    let capturedBytes = new Uint8Array();
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async (request) => {
        capturedMethod = request.methodId;
        capturedBytes = request.requestBytes;
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

    const response = await hook.invoke('runtime_bridge_unary', {
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: toBase64(Uint8Array.from([1, 2, 3])),
      },
    }) as { responseBytesBase64: string };

    expect(capturedMethod).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect([...capturedBytes]).toEqual([1, 2, 3]);
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

    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent('https://evil.invalid').event, {
      command: 'runtime_bridge_status',
      payload: {},
    })).rejects.toMatchObject({ code: 'NIMI_ELECTRON_ORIGIN_NOT_ALLOWED' });
    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent().event, {
      command: 'runtime_bridge_start',
      payload: {},
    })).rejects.toMatchObject({
      code: 'NIMI_ELECTRON_EXTERNAL_DAEMON_REQUIRED',
      reasonCode: 'external-daemon-required',
    });
    expect(createElectronExternalDaemonRequiredError('runtime_bridge_restart').reasonCode).toBe('external-daemon-required');
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

    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent('https://evil.invalid').event, {
      command: 'runtime_bridge_status',
      payload: {},
    })).rejects.toMatchObject({ code: 'NIMI_ELECTRON_ORIGIN_NOT_ALLOWED' });
  });

  it('reports external daemon status from a real probe instead of hardcoded success', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => {
          throw new Error('daemon offline');
        },
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent().event, {
      command: 'runtime_bridge_status',
      payload: {},
    })).resolves.toMatchObject({
      running: false,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
      lastError: expect.stringContaining('daemon offline'),
    });
  });

  it('pins app identity and rejects renderer-supplied sensitive auth fields', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => ({ responseBytes: new Uint8Array() }),
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    const basePayload = {
      methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
      requestBytesBase64: '',
    };
    for (const payload of [
      { ...basePayload, authorization: 'Bearer renderer' },
      { ...basePayload, protectedAccessToken: { tokenId: 'renderer', secret: 'secret' } },
      { ...basePayload, appSession: { sessionId: 'renderer', sessionToken: 'secret' } },
      { ...basePayload, metadata: { appId: 'evil.app' } },
      { ...basePayload, metadata: { callerKind: 'desktop-host' } },
      { ...basePayload, metadata: { callerId: 'evil.caller' } },
      { ...basePayload, metadata: { participantId: 'evil.participant' } },
      { ...basePayload, metadata: { extra: { 'x-nimi-authorization': 'Bearer renderer' } } },
      { ...basePayload, metadata: { extra: { 'x-nimi-provider-api-key': 'secret' } } },
      { ...basePayload, metadata: { extra: { 'x-nimi-session-token': 'session-token' } } },
    ]) {
      await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent().event, {
        command: 'runtime_bridge_unary',
        payload,
      })).rejects.toMatchObject({ code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID' });
    }
  });

  it('accepts only strict base64 Runtime byte payloads', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => ({ responseBytes: new Uint8Array() }),
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent().event, {
      command: 'runtime_bridge_unary',
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: 'not base64!',
      },
    })).rejects.toMatchObject({ code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID' });
  });

  it('dispatches app-owned Electron shell commands through the same narrowed bridge', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      commandHandlers: {
        tester_run_history_load: async ({ payload, appId }) => ({
          appId,
          payload,
          recordsJson: '{}',
        }),
      },
    });

    await expect(ipcMain.invoke('nimi:runtime:invoke', createInvokeEvent().event, {
      command: 'tester_run_history_load',
      payload: { storageRoot: 'D:/tester/data' },
    })).resolves.toEqual({
      appId: 'nimi.tester',
      payload: { storageRoot: 'D:/tester/data' },
      recordsJson: '{}',
    });
  });

  it('forwards server-stream chunks to the scoped renderer event channel and closes streams', async () => {
    let canceled = false;
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: () => {
        throw new Error('not used');
      },
      serverStream: () => ({
        cancel: () => {
          canceled = true;
        },
        start: ({ onData, onEnd }) => {
          onData(Uint8Array.from([9, 8, 7]));
          onEnd();
        },
      }),
      close: () => undefined,
    };
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => fakeClient,
    });
    const { event, sent } = createInvokeEvent();
    const openResponse = await ipcMain.invoke('nimi:runtime:invoke', event, {
      command: 'runtime_bridge_stream_open',
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
        streamId: 'stream-1',
        requestBytesBase64: toBase64(Uint8Array.from([1])),
      },
    }) as { streamId: string };

    expect(openResponse.streamId).toBe('stream-1');
    expect(sent).toEqual([
      {
        channel: 'nimi:runtime:event:runtime_bridge:stream:stream-1',
        payload: {
          streamId: 'stream-1',
          eventType: 'next',
          payloadBytesBase64: toBase64(Uint8Array.from([9, 8, 7])),
        },
      },
      {
        channel: 'nimi:runtime:event:runtime_bridge:stream:stream-1',
        payload: {
          streamId: 'stream-1',
          eventType: 'completed',
        },
      },
    ]);

    await ipcMain.invoke('nimi:runtime:invoke', event, {
      command: 'runtime_bridge_stream_close',
      payload: { streamId: 'stream-1' },
    });
    expect(canceled).toBe(false);
  });
});
