import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronInstalledAppBridge } from '../src/main/index.js';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
} from './electron-shell-test-utils.js';

function registerFixture(ipcMain: FakeIpcMain) {
  return registerNimiElectronInstalledAppBridge({
    appId: 'nimi.thirdparty.fixture',
    allowedRendererUrls: ['http://localhost:1430/'],
    ipcMain,
  });
}

function createInstalledInvokeEvent() {
  const { event } = createInvokeEvent();
  return {
    ...event,
    senderFrame: {
      ...event.senderFrame,
      url: 'http://localhost:1430/',
    },
  };
}

describe('registerNimiElectronInstalledAppBridge', () => {
  it('denies ordinary Runtime commands before any gRPC client can be constructed', async () => {
    const ipcMain = new FakeIpcMain();
    registerFixture(ipcMain);

    await expect(invokeBridge(ipcMain, createInstalledInvokeEvent(), {
      command: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
      payload: { payload: { methodId: 'nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus' } },
    })).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-not-in-host-set',
    });
  });

  it('exposes only the native installed artifact command and preserves typed carrier failures', async () => {
    const ipcMain = new FakeIpcMain();
    registerFixture(ipcMain);

    await expect(invokeBridge(ipcMain, createInstalledInvokeEvent(), {
      command: NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'],
      payload: { payload: { artifactId: 'artifact-fixture' } },
    })).rejects.toSatisfy((error: unknown) => {
      const reasonCode = (error as { reasonCode?: unknown })?.reasonCode;
      return [
        'protected-carrier-required',
        'runtime-service-unavailable',
        'runtime-service-untrusted',
        'runtime-service-repair-required',
      ].includes(String(reasonCode || ''));
    });
  });

  it('rejects app-owned endpoint, capability, handler, and native-host fields', () => {
    for (const forbidden of [
      { runtimeEndpoint: '127.0.0.1:46371' },
      { capabilitySetRef: 'forged' },
      { commandHandlers: {} },
      { installedHost: {} },
    ]) {
      expect(() => registerNimiElectronInstalledAppBridge({
        appId: 'nimi.thirdparty.fixture',
        allowedRendererUrls: ['http://localhost:1430/'],
        ipcMain: new FakeIpcMain(),
        ...forbidden,
      } as never)).toThrow(expect.objectContaining({
        code: 'invalid-payload',
        reasonCode: 'electron-installed-bridge-input-forbidden',
      }));
    }
  });
});
