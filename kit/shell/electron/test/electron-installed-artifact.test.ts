import { describe, expect, it } from 'vitest';
import {
  NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

import {
  NimiElectronAppHostError,
  registerNimiElectronRuntimeBridge,
} from '../src/main/index.js';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
} from './electron-shell-test-utils.js';

const command = NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'];

describe('Electron installed artifact standard-shell operation', () => {
  it('forwards only the artifact selector through the typed installed host', async () => {
    const ipcMain = new FakeIpcMain();
    const reads: string[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'fixed-protected-local',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: () => {
        throw new Error('ordinary gRPC client must not be created');
      },
      standardShellHost: {
        capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        appHost: {
          async bootstrap() {
            return appHostBootstrap();
          },
          async readArtifactBytes(artifactId) {
            reads.push(artifactId);
            return {
              bytes: new TextEncoder().encode('artifact'),
              mimeType: 'text/plain',
              sizeBytes: 8,
              mimeInferred: false,
            };
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command,
      payload: { payload: { artifactId: 'artifact-one' } },
    })).resolves.toEqual({
      dataBase64: 'YXJ0aWZhY3Q=',
      mimeType: 'text/plain',
      sizeBytes: 8,
      mimeInferred: false,
    });
    expect(reads).toEqual(['artifact-one']);
  });

  it('rejects extra renderer fields before calling the installed host', async () => {
    const ipcMain = new FakeIpcMain();
    let called = false;
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'fixed-protected-local',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      standardShellHost: {
        capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        appHost: {
          async bootstrap() {
            return appHostBootstrap();
          },
          async readArtifactBytes() {
            called = true;
            throw new Error('must not run');
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command,
      payload: {
        payload: {
          artifactId: 'artifact-one',
          sessionProof: 'renderer-forgery',
        },
      },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-installed-artifact-payload-invalid',
    });
    expect(called).toBe(false);
  });

  it('preserves typed Runtime denial and fails closed without a native host', async () => {
    for (const appHost of [
      undefined,
      {
        async readArtifactBytes(): Promise<never> {
          throw new NimiElectronAppHostError('installed-artifact-forbidden', false);
        },
        async bootstrap() {
          return appHostBootstrap();
        },
      },
    ]) {
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.thirdparty.fixture',
        runtimeEndpoint: 'fixed-protected-local',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        standardShellHost: {
          capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          appHost,
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: { payload: { artifactId: 'artifact-denied' } },
      })).rejects.toMatchObject({
        code: appHost ? 'runtime-permission-denied' : 'protected-carrier-required',
        reasonCode: appHost ? 'installed-artifact-forbidden' : 'protected-carrier-required',
      });
    }
  });
});

function appHostBootstrap() {
  return {
    state: 'ready' as const,
    trustClass: 'local-development' as const,
    appId: 'nimi.thirdparty.fixture',
    bootstrapArtifactId: 'bootstrap-artifact',
    expiresAtUnixMs: 1_800_000_000_000,
  };
}
