import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import {
  registerNimiElectronRuntimeBridge,
  type ElectronRuntimeBridgeTrustedMetadataProvider,
  type RuntimeGrpcBridgeClient,
  type NimiElectronStandardShellHost,
} from '../src/main/index.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  AppStorageState,
  GetAppStorageRequest,
  GetAppStorageResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/app.js';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';

const GET_APP_STORAGE_METHOD_ID = '/nimi.runtime.v1.RuntimeAppService/GetAppStorage';

function registerBindingBridge(input: {
  readonly standardShellHost?: NimiElectronStandardShellHost;
  readonly createGrpcClient?: () => Promise<RuntimeGrpcBridgeClient>;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
}): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronRuntimeBridge({
    appId: 'acme.widget',
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: input.createGrpcClient ?? (async () => {
      throw new Error('not used');
    }),
    trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
    standardShellHost: input.standardShellHost
      ? { allowAllStandardShellCommands: true, ...input.standardShellHost }
      : undefined,
  });
  return ipcMain;
}

function appStorageResponseBytes(input: {
  readonly state: AppStorageState;
  readonly durableDataRoot: string;
}): Uint8Array {
  return GetAppStorageResponse.toBinary(GetAppStorageResponse.create({
    projection: {
      appId: 'acme.widget',
      state: input.state,
      durableDataRoot: input.durableDataRoot,
    },
  }));
}

describe('Electron standard data root binding', () => {
  it('resolves Product Control bindings lazily for the current command', async () => {
    await withTempDir('binding-product-control', async (root) => {
      const dataRoot = path.join(root, 'data');
      let resolverCalls = 0;
      const ipcMain = registerBindingBridge({
        standardShellHost: {
          standardDataRootBinding: {
            source: 'product-control-projection',
            resolveDataRoot: async () => {
              resolverCalls += 1;
              return dataRoot;
            },
          },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: 'settings/profile.json' },
      }) as { path: string };

      expect(result.path).toBe(path.join(await realpath(dataRoot), 'settings', 'profile.json'));
      expect(resolverCalls).toBe(1);
    });
  });

  it('keeps the complete standard storage operation inside the product Host root gate', async () => {
    await withTempDir('binding-product-control-gate', async (root) => {
      const dataRoot = path.join(root, 'data');
      let release: (() => void) | undefined;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      let entered = false;
      let resolverCalls = 0;
      const ipcMain = registerBindingBridge({
        standardShellHost: {
          runDataRootOperation: async (operation) => {
            entered = true;
            await barrier;
            return operation();
          },
          standardDataRootBinding: {
            source: 'product-control-projection',
            resolveDataRoot: async () => {
              resolverCalls += 1;
              return dataRoot;
            },
          },
        },
      });
      const pending = invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: { relativePath: 'settings/profile.json', value: { enabled: true } },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(entered).toBe(true);
      expect(resolverCalls).toBe(0);
      release?.();
      await pending;
      expect(resolverCalls).toBe(1);
      expect(JSON.parse(await readFile(path.join(dataRoot, 'settings', 'profile.json'), 'utf8'))).toEqual({ enabled: true });
    });
  });

  it('fails closed when the Product Control binding has no selected data root', async () => {
    const ipcMain = registerBindingBridge({
      standardShellHost: {
        standardDataRootBinding: {
          source: 'product-control-projection',
          resolveDataRoot: async () => {
            throw new Error('desktop-product-control-selected-data-root-unavailable');
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      payload: { relativePath: 'settings/profile.json' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-product-control-data-root-unavailable',
    });
  });

  it('resolves runtime-get-app-storage bindings through GetAppStorage once and caches the roots', async () => {
    await withTempDir('binding-runtime', async (root) => {
      const dataRoot = path.join(root, 'data');
      let getAppStorageCalls = 0;
      let trustedMetadataCalls = 0;
      const trustedRuntimeMetadataProvider: ElectronRuntimeBridgeTrustedMetadataProvider = async (input) => {
        expect(input).toMatchObject({
          command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
          methodId: GET_APP_STORAGE_METHOD_ID,
          appId: 'acme.widget',
          runtimeEndpoint: '127.0.0.1:46371',
        });
        trustedMetadataCalls += 1;
        return {
          metadata: {
            participantId: 'acme.widget',
            callerKind: 'third-party-app',
            callerId: 'acme.widget',
          },
          appSession: {
            sessionId: 'session-id',
            sessionToken: 'session-token',
          },
        };
      };
      const client: RuntimeGrpcBridgeClient = {
        unary: async (request) => {
          expect(request.methodId).toBe(GET_APP_STORAGE_METHOD_ID);
          expect(GetAppStorageRequest.fromBinary(request.requestBytes).appId).toBe('acme.widget');
          expect(request.metadata).toMatchObject({
            'x-nimi-protocol-version': '1.0.0',
            'x-nimi-participant-protocol-version': '1.0.0',
            'x-nimi-participant-id': 'acme.widget',
            'x-nimi-domain': 'runtime.rpc',
            'x-nimi-app-id': 'acme.widget',
            'x-nimi-caller-kind': 'third-party-app',
            'x-nimi-caller-id': 'acme.widget',
            'x-nimi-session-id': 'session-id',
            'x-nimi-session-token': 'session-token',
          });
          expect(request.metadata?.['x-nimi-idempotency-key']).toMatch(
            /^bridge-_nimi\.runtime\.v1\.RuntimeAppService_GetAppStorage-/u,
          );
          expect(request.metadata).not.toHaveProperty('app_id');
          getAppStorageCalls += 1;
          return {
            responseBytes: appStorageResponseBytes({
              state: AppStorageState.READY,
              durableDataRoot: dataRoot,
            }),
          };
        },
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      };
      const ipcMain = registerBindingBridge({
        createGrpcClient: async () => client,
        trustedRuntimeMetadataProvider,
        standardShellHost: {
          standardDataRootBinding: { source: 'runtime-get-app-storage' },
        },
      });
      const { event } = createInvokeEvent();

      const writeResult = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: {
          relativePath: 'settings/profile.json',
          value: { schemaVersion: 1, enabled: true },
        },
      }) as { path: string; value: Record<string, unknown> };
      expect(writeResult.path).toBe(path.join(await realpath(dataRoot), 'settings', 'profile.json'));
      expect(JSON.parse(await readFile(writeResult.path, 'utf8'))).toEqual({ schemaVersion: 1, enabled: true });

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).resolves.toEqual({
        path: writeResult.path,
        value: { schemaVersion: 1, enabled: true },
      });
      await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
        payload: { relativePath: 'settings/profile.json' },
      });

      expect(getAppStorageCalls).toBe(1);
      expect(trustedMetadataCalls).toBe(1);
    });
  });

  it('fails closed when the Runtime app storage projection is not ready', async () => {
    await withTempDir('binding-not-ready', async (root) => {
      const client: RuntimeGrpcBridgeClient = {
        unary: async () => ({
          responseBytes: appStorageResponseBytes({
            state: AppStorageState.INSTALL_REQUIRED,
            durableDataRoot: path.join(root, 'data'),
          }),
        }),
        serverStream: () => {
          throw new Error('not used');
        },
        close: () => undefined,
      };
      const ipcMain = registerBindingBridge({
        createGrpcClient: async () => client,
        standardShellHost: {
          standardDataRootBinding: { source: 'runtime-get-app-storage' },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        payload: { relativePath: 'settings/profile.json' },
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'electron-runtime-app-storage-not-ready',
      });
    });
  });

  it('fails closed when no standard data root binding is provided', async () => {
    const ipcMain = registerBindingBridge({ standardShellHost: {} });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      payload: { relativePath: 'settings/profile.json' },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-data-root-binding-missing',
    });
  });

  it('rejects launch-projection bindings with non-absolute durable data roots', async () => {
    const ipcMain = registerBindingBridge({
      standardShellHost: {
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: 'relative/x',
          projectionRef: 'electron-shell-test-fixture',
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
      payload: { relativePath: 'settings/profile.json', value: { ok: true } },
    })).rejects.toMatchObject({
      reasonCode: 'electron-standard-data-root-binding-invalid',
    });
  });

  it('rejects renderer payloads carrying forbidden storage root fields', async () => {
    await withTempDir('binding-forbidden-field', async (root) => {
      const ipcMain = registerBindingBridge({
        standardShellHost: {
          standardDataRootBinding: {
            source: 'runtime-launch-projection',
            durableDataRoot: path.join(root, 'data'),
            projectionRef: 'electron-shell-test-fixture',
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
        payload: {
          relativePath: 'settings/profile.json',
          value: { ok: true },
          dataRoot: '/tmp/renderer-supplied',
        },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'electron-standard-storage-renderer-field-forbidden',
      });
    });
  });
});
