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

describe('registerNimiElectronRuntimeBridge', () => {
  it('hardcuts generic Runtime config commands', async () => {
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
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.get'],
      payload: {},
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
      payload: { configJson: '{"schemaVersion":1}' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
    });
  });

  it('keeps auth session custody fail-closed under the external Runtime account service', async () => {
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

    for (const command of [
      'nimi.shell.auth.session.load',
      'nimi.shell.auth.session.save',
      'nimi.shell.auth.session.clear',
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: { accessToken: 'renderer-token' },
      })).rejects.toMatchObject({
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-account-custody-external',
        source: 'electron',
      });
    }
  });

  it('denies forbidden and planned commands before dispatch for local-app hosts', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'community.nimi.fixture.platform-proof',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('forbidden command must not initialize Runtime client');
      },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAgentIdentity: {
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'tester-runtime',
          localAgentRef: 'local-agent:opaque-tester-runtime',
        },
      },
    });

    for (const command of [
      NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
      NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'],
      NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'],
      NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
      NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
      NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: {},
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-not-in-host-set',
        source: 'electron',
        details: {
          command,
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        },
      });
    }
  });

  it('rejects renderer-provided bearer and session metadata for protected Runtime calls', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'community.nimi.fixture.platform-proof',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('renderer-owned auth metadata must not reach Runtime client');
      },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      },
    });
    const protectedPayloads = [
      { authorization: 'Bearer renderer-token' },
      { appSession: { sessionId: 'renderer-session', sessionToken: 'renderer-secret' } },
      { protectedAccessToken: { tokenId: 'renderer-token-id', secret: 'renderer-secret' } },
      { metadata: { extra: { 'x-nimi-session-id': 'renderer-session' } } },
      { metadata: { extra: { 'x-nimi-session-token': 'renderer-secret' } } },
      { metadata: { extra: { authorization: 'Bearer renderer-token' } } },
    ];

    for (const payload of protectedPayloads) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: STANDARD_COMMANDS.unary,
        payload: {
          methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
          requestBytesBase64: '',
          ...payload,
        },
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-not-in-host-set',
        source: 'electron',
      });
    }
  });

  it('fails closed when external daemon status probe cannot reach Runtime', async () => {
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

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
    });
  });

  it('fails closed when external daemon status cannot initialize a Runtime client', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('client bootstrap failed');
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).rejects.toMatchObject({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
    });
  });

  it('reports external daemon status from a real Runtime probe response', async () => {
    const ipcMain = new FakeIpcMain();
    const unaryRequests: ElectronRuntimeBridgeUnaryRequest[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => ({
        unary: async (request) => {
          unaryRequests.push(request);
          return {
            responseBytes: new Uint8Array(),
            responseMetadata: { 'x-nimi-runtime-version': 'runtime-2026.6' },
          };
        },
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      }),
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: STANDARD_COMMANDS.status,
      payload: {},
    })).resolves.toEqual({
      running: true,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
      version: 'runtime-2026.6',
    });
    expect(unaryRequests[0]?.methodId).toBe('/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    expect(unaryRequests[0]?.timeoutMs).toBe(1_000);
  });
});
