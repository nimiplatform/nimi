import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  createElectronShellFileProtocolHost,
  registerNimiElectronRuntimeBridge,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  STANDARD_EVENT_NAMESPACE,
  createInvokeEvent,
  invokeBridge,
  toBase64,
  withTempDir,
} from './electron-shell-test-utils.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';

describe('registerNimiElectronRuntimeBridge runtime hardening', () => {
  it('fails closed for Electron standard file capability path escapes and missing assets', async () => {
    await withTempDir('standard-negative', async (root) => {
      const dataRoot = path.join(root, 'data');
      const assetRoot = path.join(root, 'assets');
      await mkdir(dataRoot, { recursive: true });
      await mkdir(assetRoot, { recursive: true });
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          standardDataRootBinding: {
            source: 'runtime-launch-projection',
            durableDataRoot: dataRoot,
            projectionRef: 'electron-shell-test-fixture',
          },
          localAssetRoots: [assetRoot],
          localAssetProtocolHost: createElectronShellFileProtocolHost({
            protocol: new FakeElectronProtocol(),
            roots: [assetRoot],
          }),
        },
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: '../escape.json' },
      })).rejects.toMatchObject({
        code: 'invalid-path',
        reasonCode: 'electron-standard-path-escapes-root',
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: { relativePath: 'bad.json', value: undefined },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'electron-standard-json-value-required',
      });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        payload: { path: path.join(assetRoot, 'missing.txt') },
      })).rejects.toMatchObject({
        code: 'not-found',
        reasonCode: 'electron-standard-local-asset-not-found',
      });
    });
  });

  it('hardcuts Electron generic Runtime config mutation', async () => {
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

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      payload: { configJson: '{"schemaVersion":1}' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
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
      methodId: '/nimi.runtime.v1.RuntimeModelService/ListModels',
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
      { ...basePayload, metadata: { extra: { 'x-nimi-session-token': 'session-token' } } },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: STANDARD_COMMANDS.unary,
        payload,
      })).rejects.toMatchObject({ code: 'forbidden-renderer-access' });
    }
  });

  it('rejects retired caller AI input metadata instead of forwarding it', async () => {
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

    for (const key of [
      'x-nimi-key-source',
      'x-nimi-provider-type',
      'x-nimi-provider-endpoint',
      'x-nimi-provider-api-key',
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: STANDARD_COMMANDS.unary,
        payload: {
          methodId: '/nimi.runtime.v1.RuntimeModelService/ListModels',
          requestBytesBase64: '',
          metadata: { extra: { [key]: 'retired' } },
        },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'electron-runtime-caller-ai-input-metadata-retired',
      });
    }
  });

  it('accepts only strict base64 Runtime byte payloads', async () => {
    const ipcMain = new FakeIpcMain();
    let observedRequestByteLength = 0;
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async (request) => {
          observedRequestByteLength = request.requestBytes.byteLength;
          return { responseBytes: new Uint8Array() };
        },
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeModelService/ListModels',
        requestBytesBase64: 'not base64!',
      },
    })).rejects.toMatchObject({ code: 'invalid-payload' });

    const avatarSizedPayload = 'A'.repeat(10_504_952);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeModelService/ListModels',
        requestBytesBase64: avatarSizedPayload,
      },
    })).resolves.toEqual({ responseBytesBase64: '' });
    expect(observedRequestByteLength).toBe(7_878_714);
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

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
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
    const openResponse = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_open,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeModelService/WatchModels',
        streamId: 'stream-1',
        requestBytesBase64: toBase64(Uint8Array.from([1])),
      },
    }) as { streamId: string };

    expect(openResponse.streamId).toBe('stream-1');
    expect(sent).toEqual([
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-1`,
        payload: {
          streamId: 'stream-1',
          eventType: 'next',
          payloadBytesBase64: toBase64(Uint8Array.from([9, 8, 7])),
        },
      },
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-1`,
        payload: {
          streamId: 'stream-1',
          eventType: 'completed',
        },
      },
    ]);

    await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_close,
      payload: { streamId: 'stream-1' },
    });
    expect(canceled).toBe(false);
  });

  it('maps server-stream Runtime endpoint failures to the standard unavailable envelope', async () => {
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: () => {
        throw new Error('not used');
      },
      serverStream: () => ({
        cancel: () => undefined,
        start: ({ onError }) => {
          onError(new Error('daemon offline'));
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

    const openResponse = await invokeBridge(ipcMain, event, {
      command: STANDARD_COMMANDS.stream_open,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeModelService/WatchModels',
        streamId: 'stream-unavailable',
        requestBytesBase64: '',
      },
    }) as { streamId: string };

    expect(openResponse.streamId).toBe('stream-unavailable');
    expect(sent).toEqual([
      {
        channel: `nimi:runtime:event:${STANDARD_EVENT_NAMESPACE}:stream:stream-unavailable`,
        payload: {
          streamId: 'stream-unavailable',
          eventType: 'error',
          error: expect.objectContaining({
            code: 'external-daemon-required',
            reasonCode: 'electron-runtime-endpoint-unavailable',
            source: 'electron',
          }),
        },
      },
    ]);
  });
});
