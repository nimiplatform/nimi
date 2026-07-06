import { describe, expect, it } from 'vitest';
import {
  registerNimiElectronRuntimeBridge,
  type RuntimeGrpcBridgeClient,
} from '../src/main/index.js';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  createInvokeEvent,
  invokeBridge,
} from './electron-shell-test-utils.js';

describe('Electron Runtime trusted metadata provider', () => {
  it('maps endpoint failures to external daemon required before unary dispatch', async () => {
    const fakeClient: RuntimeGrpcBridgeClient = {
      unary: async () => {
        throw new Error('not reached');
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
      trustedRuntimeMetadataProvider: async () => {
        throw Object.assign(new Error('14 UNAVAILABLE: daemon offline'), {
          reasonCode: 'RUNTIME_GRPC_UNAVAILABLE',
          details: { grpcCode: 14 },
        });
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.unary,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: '',
      },
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
    });
  });
});
