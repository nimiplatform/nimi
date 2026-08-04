import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_CAPABILITIES } from '@nimiplatform/kit/shell/capabilities';

import { registerNimiElectronAppBridge } from '../src/main/index.js';
import { dispatchElectronLocalAppCommand } from '../src/main/local-app-commands.js';
import { NimiElectronLocalAppHostError } from '../src/main/local-app-host.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

const FINAL_LOCAL_APP_COMMANDS = [
  'nimi.shell.localApp.sessionStatus',
  'nimi.shell.localApp.permissionStatus',
  'nimi.shell.localApp.permissionRequest',
  'nimi.shell.localApp.aiConfigGet',
  'nimi.shell.localApp.aiConfigOverwrite',
  'nimi.shell.localApp.textGenerateCandidate',
  'nimi.shell.localApp.conversationOpen',
  'nimi.shell.localApp.conversationSendTurn',
  'nimi.shell.localApp.conversationInterruptTurn',
  'nimi.shell.localApp.conversationSubscribe',
  'nimi.shell.localApp.conversationSnapshot',
  'nimi.shell.localApp.artifactPut',
  'nimi.shell.localApp.artifactReadBytes',
  'nimi.shell.localApp.sharedAgentAIConfigGet',
  'nimi.shell.localApp.sharedAgentAIConfigOverwrite',
  'nimi.shell.localApp.sharedAgentAIProfilePreview',
  'nimi.shell.localApp.sharedAgentAIProfileApply',
  'nimi.shell.localApp.agentAutonomySnapshot',
  'nimi.shell.localApp.agentUpdateAutonomy',
  'nimi.shell.localApp.agentPresentationSnapshot',
  'nimi.shell.localApp.agentCommitPresentation',
  'nimi.shell.localApp.realmWorldCoreList',
  'nimi.shell.localApp.realmWorldCoreCreate',
  'nimi.shell.storage.readJson',
  'nimi.shell.storage.writeJson',
  'nimi.shell.storage.removeJson',
] as const;

function createBridge() {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronAppBridge({
    appId: 'nimi.thirdparty.fixture',
    allowedRendererUrls: ['http://localhost:1430/'],
    ipcMain,
    onProtectedSessionFailure: () => undefined,
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
  it('requires a host-close callback for protected session bootstrap and renewal failure', () => {
    expect(() => registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      ipcMain: new FakeIpcMain(),
    } as never)).toThrow(/input contains forbidden authority fields/i);
  });

  it('routes exact app-owned commands without turning them into Nimi permissions', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      ipcMain,
      onProtectedSessionFailure: () => undefined,
      appCommandHandlers: {
        'fixture.sqlite.read': ({ payload }) => ({ owner: 'fixture', payload }),
      },
    });
    const { event } = createInvokeEvent();
    const exactEvent = {
      ...event,
      senderFrame: { ...event.senderFrame, url: 'http://localhost:1430/' },
    };

    await expect(invokeBridge(ipcMain, exactEvent, {
      command: 'fixture.sqlite.read',
      payload: { rowId: 'row-1' },
    })).resolves.toEqual({ owner: 'fixture', payload: { rowId: 'row-1' } });

    const routeIpcMain = new FakeIpcMain();
    registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/timeline?child=local#today'],
      ipcMain: routeIpcMain,
      onProtectedSessionFailure: () => undefined,
      appCommandHandlers: {
        'fixture.sqlite.read': ({ payload }) => ({ owner: 'fixture', payload }),
      },
    });
    const { event: routeEvent } = createInvokeEvent();
    const sameOriginRouteEvent = {
      ...routeEvent,
      senderFrame: { ...routeEvent.senderFrame, url: 'http://localhost:1430/timeline?child=local#today' },
    };
    await expect(invokeBridge(routeIpcMain, sameOriginRouteEvent, {
      command: 'fixture.sqlite.read',
      payload: { rowId: 'row-2' },
    })).resolves.toEqual({ owner: 'fixture', payload: { rowId: 'row-2' } });

    const foreignIpcMain = new FakeIpcMain();
    registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      ipcMain: foreignIpcMain,
      onProtectedSessionFailure: () => undefined,
      appCommandHandlers: {
        'fixture.sqlite.read': ({ payload }) => ({ owner: 'fixture', payload }),
      },
    });
    const { event: foreignBaseEvent } = createInvokeEvent();
    const foreignOriginEvent = {
      ...foreignBaseEvent,
      senderFrame: { ...foreignBaseEvent.senderFrame, url: 'http://localhost:1431/timeline' },
    };
    await expect(invokeBridge(foreignIpcMain, foreignOriginEvent, {
      command: 'fixture.sqlite.read',
      payload: { rowId: 'row-3' },
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-renderer-url-not-allowed',
    });
  });

  it('keeps the Nimi shell namespace unavailable to app-owned handlers', () => {
    const ipcMain = new FakeIpcMain();
    expect(() => registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      ipcMain,
      onProtectedSessionFailure: () => undefined,
      appCommandHandlers: {
        'nimi.shell.runtime.unary': () => ({ forged: true }),
      },
    })).toThrow(/command handler is invalid/i);
  });

  it('routes every final local-app command to the protected carrier rather than generic capability denial', async () => {
    for (const command of FINAL_LOCAL_APP_COMMANDS) {
      const { ipcMain, event } = createBridge();
      const error = await invokeBridge(ipcMain, event, { command, payload: {} }).catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toMatchObject({ reasonCode: 'electron-standard-capability-not-in-host-set' });
      expect(String((error as { reasonCode?: unknown }).reasonCode || '')).toMatch(
        /^(protected-carrier-required|runtime-service-unavailable|runtime-service-untrusted|runtime-service-error-unclassified|runtime-unauthenticated|permission-unavailable|invalid-payload)$/,
      );
    }
  });

  it('maps AI Runtime failures to a declared text-candidate negative state', async () => {
    const command = 'nimi.shell.localApp.textGenerateCandidate';
    const host = {
      textGenerateCandidate: async () => {
        throw new NimiElectronLocalAppHostError('ai-local-model-unavailable', false);
      },
    } as never;
    const error = await dispatchElectronLocalAppCommand({
      host,
      command,
      payload: {
        messages: [{ role: 'user', text: 'Create one persona.' }],
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 512,
      },
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      code: 'runtime-permission-denied',
      reasonCode: 'ai-local-model-unavailable',
    });
    const operation = NIMI_STANDARD_SHELL_CAPABILITIES
      .find((capability) => capability.id === 'local-app')
      ?.operations.find((candidate) => candidate.id === 'textGenerateCandidate');
    expect(operation?.negativeStates).toContain((error as { code: string }).code);
  });

  it('denies protected Agent operations until a public permission is admitted', async () => {
    const { ipcMain, event } = createBridge();
    await expect(invokeBridge(ipcMain, event, {
      command: 'nimi.shell.localApp.agent.sendTurn',
      payload: {},
    })).rejects.toMatchObject({ code: 'capability-unavailable' });
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
