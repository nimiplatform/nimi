import { describe, expect, it } from 'vitest';

import { registerNimiElectronAppBridge } from '../src/main/index.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

const FINAL_LOCAL_APP_COMMANDS = [
  'nimi.shell.localApp.sessionStatus',
  'nimi.shell.localApp.permissionPosture',
  'nimi.shell.localApp.permissionRequest',
  'nimi.shell.localApp.artifacts.readRuntimeBytes',
  'nimi.shell.storage.readJson',
  'nimi.shell.storage.writeJson',
  'nimi.shell.storage.removeJson',
  'nimi.shell.localApp.agent.openConversation',
  'nimi.shell.localApp.agent.sendTurn',
  'nimi.shell.localApp.agent.subscribeTurn',
  'nimi.shell.localApp.agent.getConversationSnapshot',
] as const;

function createBridge() {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronAppBridge({
    appId: 'nimi.thirdparty.fixture',
    allowedRendererUrls: ['http://localhost:1430/'],
    ipcMain,
  });
  const { event } = createInvokeEvent();
  return {
    ipcMain,
    event: {
      ...event,
      senderFrame: { ...event.senderFrame, url: 'http://localhost:1430/' },
    },
  };
}

describe('Electron local-app carrier behavior', () => {
  it('routes every final local-app command to the protected carrier rather than generic capability denial', async () => {
    for (const command of FINAL_LOCAL_APP_COMMANDS) {
      const { ipcMain, event } = createBridge();
      const error = await invokeBridge(ipcMain, event, { command, payload: {} }).catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toMatchObject({ reasonCode: 'electron-standard-capability-not-in-host-set' });
      expect(String((error as { reasonCode?: unknown }).reasonCode || '')).toMatch(
        /^(protected-carrier-required|runtime-service-unavailable|runtime-service-untrusted|runtime-unauthenticated|no-grant|invalid-payload)$/,
      );
    }
  });

  it('denies generic proxy, lifecycle, auth, OAuth, filesystem and desktop-private commands', async () => {
    for (const command of [
      'nimi.shell.runtime.unary',
      'nimi.shell.runtimeLifecycle.restart',
      'nimi.shell.auth.sessionLoad',
      'nimi.shell.oauth.tokenExchange',
      'nimi.shell.fileDialog.open',
      'nimi.shell.desktopPrivate.productControl',
    ]) {
      const { ipcMain, event } = createBridge();
      await expect(invokeBridge(ipcMain, event, { command, payload: {} })).rejects.toMatchObject({
        code: 'capability-unavailable',
      });
    }
  });

  it('rejects renderer-supplied protected authority material', async () => {
    for (const field of [
      'endpoint', 'token', 'localAppPrincipalId', 'localAppRecordId', 'grantId',
      'sessionId', 'sessionProof', 'processId', 'trustClass',
    ]) {
      const { ipcMain, event } = createBridge();
      await expect(invokeBridge(ipcMain, event, {
        command: FINAL_LOCAL_APP_COMMANDS[0],
        payload: { [field]: 'forged' },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
    }
  });
});
