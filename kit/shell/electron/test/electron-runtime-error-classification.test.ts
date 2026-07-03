import { describe, expect, it } from 'vitest';
import { registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import {
  FakeIpcMain,
  STANDARD_COMMANDS,
  createInvokeEvent,
  invokeBridge,
} from './electron-shell-test-utils.js';

describe('Electron Runtime error classification', () => {
  it('preserves Runtime permission denied failures instead of reporting daemon unavailable', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => {
          throw Object.assign(
            new Error('7 PERMISSION_DENIED: {"actionHint":"authorize_missing_protected_scope","reasonCode":"APP_SCOPE_FORBIDDEN"}'),
            { code: 7 },
          );
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
        methodId: '/nimi.runtime.v1.RuntimeAgentService/ListLocalAgents',
        requestBytesBase64: '',
      },
    })).rejects.toMatchObject({
      code: 'runtime-permission-denied',
      reasonCode: 'APP_SCOPE_FORBIDDEN',
      actionHint: 'authorize_missing_protected_scope',
      source: 'runtime',
      details: {
        grpcCode: 7,
      },
    });
  });

  it('preserves Runtime unauthenticated failures instead of reporting daemon unavailable', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async () => {
          throw Object.assign(
            new Error('16 UNAUTHENTICATED: {"actionHint":"authenticate_runtime_account","reasonCode":"PRINCIPAL_UNAUTHENTICATED"}'),
            { code: 16 },
          );
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
        methodId: '/nimi.runtime.v1.RuntimeAgentService/ListLocalAgents',
        requestBytesBase64: '',
      },
    })).rejects.toMatchObject({
      code: 'runtime-unauthenticated',
      reasonCode: 'PRINCIPAL_UNAUTHENTICATED',
      actionHint: 'authenticate_runtime_account',
      source: 'runtime',
      details: {
        grpcCode: 16,
      },
    });
  });
});
