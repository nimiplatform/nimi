import { describe, expect, it, vi } from 'vitest';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
} from '@nimiplatform/kit/shell/capabilities';

import { registerNimiElectronAppBridge, registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import { dispatchElectronLocalAppCommand } from '../src/main/local-app-commands.js';
import { NimiElectronLocalAppHostError } from '../src/main/local-app-host.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

vi.mock('../src/main/protected-local-binding-loader.js', () => ({
  loadNimiElectronProtectedLocalPackage: () => {
    throw new Error('protected carrier fixture unavailable');
  },
}));

const ASSET_MEDIA_PLATFORM = {
  protocol: {
    registerSchemesAsPrivileged: () => undefined,
    handle: () => undefined,
    unhandle: () => undefined,
  },
  session: { defaultSession: { webRequest: { onBeforeRequest: () => undefined } } },
  webContents: { fromId: () => undefined },
};

const FINAL_LOCAL_APP_COMMANDS = [
  'nimi.shell.localApp.sessionStatus',
  'nimi.shell.localApp.aiConfigGet',
  'nimi.shell.localApp.aiConfigOverwrite',
  'nimi.shell.localApp.modelConfigLocalSelectionsGet',
  'nimi.shell.localApp.textGenerateCandidate',
  'nimi.shell.localApp.textTurnStream',
  'nimi.shell.localApp.scenarioExecute',
  'nimi.shell.localApp.scenarioJobSubmit',
  'nimi.shell.localApp.scenarioJobGet',
  'nimi.shell.localApp.scenarioJobSubscribe',
  'nimi.shell.localApp.scenarioJobCancel',
  'nimi.shell.localApp.artifactRead',
  'nimi.shell.localApp.artifactUpload',
  'nimi.shell.localApp.voiceAssetsList',
  'nimi.shell.localApp.agentReferenceList',
  'nimi.shell.localApp.conversationOpen',
  'nimi.shell.localApp.conversationSendTurn',
  'nimi.shell.localApp.conversationInterruptTurn',
  'nimi.shell.localApp.conversationSubscribe',
  'nimi.shell.localApp.conversationSnapshot',
  'nimi.shell.localApp.realmWorldCoreList',
  'nimi.shell.localApp.realmWorldCoreCreate',
  'nimi.shell.storage.readJson',
  'nimi.shell.storage.writeJson',
  'nimi.shell.storage.removeJson',
  'nimi.shell.storage.assetStat',
  'nimi.shell.storage.assetList',
  'nimi.shell.storage.assetWriteOpen',
  'nimi.shell.storage.assetWriteChunk',
  'nimi.shell.storage.assetWriteCommit',
  'nimi.shell.storage.assetWriteAbort',
  'nimi.shell.storage.assetReadOpen',
  'nimi.shell.storage.assetReadNext',
  'nimi.shell.storage.assetReadClose',
  'nimi.shell.storage.assetRemove',
  'nimi.shell.storage.assetMove',
  'nimi.shell.storage.assetAdopt',
  'nimi.shell.storage.assetMediaOpen',
  'nimi.shell.storage.assetMediaRevoke',
] as const;

function createBridge() {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronAppBridge({
    appId: 'nimi.thirdparty.fixture',
    allowedRendererUrls: ['http://localhost:1430/'],
    assetMediaPlatform: {
      protocol: ASSET_MEDIA_PLATFORM.protocol,
      webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
      webContents: ASSET_MEDIA_PLATFORM.webContents,
    },
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
  it('keeps App lifecycle, typed Nimi access, and bridge registration independent when session bootstrap is unavailable', async () => {
    const ipcMain = new FakeIpcMain();
    const bridge = registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain,
      appCommandHandlers: {
        'fixture.app.alive': () => ({ running: true }),
      },
    });
    const { event } = createInvokeEvent();
    const exactEvent = {
      ...event,
      senderFrame: { ...event.senderFrame, url: 'http://localhost:1430/' },
    };

    await expect(invokeBridge(ipcMain, exactEvent, {
      command: 'nimi.shell.localApp.sessionStatus',
      payload: {},
    })).rejects.toMatchObject({ reasonCode: 'protected-carrier-required' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(ipcMain.handlers.has(bridge.invokeChannel)).toBe(true);
    await expect(invokeBridge(ipcMain, exactEvent, {
      command: 'fixture.app.alive',
      payload: {},
    })).resolves.toEqual({ running: true });
    expect(ipcMain.handlers.has(bridge.invokeChannel)).toBe(true);
    bridge.unregister();
  });

  it('rejects the retired App-owned protected-session lifecycle callback', () => {
    expect(() => registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain: new FakeIpcMain(),
      onProtectedSessionFailure: () => undefined,
    } as never)).toThrow(/input contains forbidden authority fields/i);
  });

  it('routes exact app-owned commands without turning them into Nimi permissions', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronAppBridge({
      appId: 'nimi.thirdparty.fixture',
      allowedRendererUrls: ['http://localhost:1430/'],
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain,
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
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain: routeIpcMain,
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
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain: foreignIpcMain,
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
      assetMediaPlatform: {
        protocol: ASSET_MEDIA_PLATFORM.protocol,
        webRequest: ASSET_MEDIA_PLATFORM.session.defaultSession.webRequest,
        webContents: ASSET_MEDIA_PLATFORM.webContents,
      },
      ipcMain,
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
        /^(protected-carrier-required|runtime-service-unavailable|runtime-service-untrusted|runtime-service-error-unclassified|runtime-unauthenticated|local-app-operation-unavailable|invalid-payload)$/,
      );
    }
  });

  it('invalidates opaque handles after successful managed remove, move, adopt, and overwrite commit', async () => {
    const invalidated: string[] = [];
    const asset = {
      relativePath: 'media/target.png', mediaType: 'image/png', sizeBytes: 8,
      sha256: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    };
    const localAppHost = {
      assetRemove: async () => ({ removed: true }),
      assetMove: async () => asset,
      assetAdopt: async () => asset,
      assetWriteCommit: async () => asset,
    } as never;
    const localAppAssetMediaHost = {
      invalidatePath: (relativePath: string) => { invalidated.push(relativePath); },
    } as never;
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'protected-carrier-test',
      allowedOrigins: ['http://localhost:1430'],
      allowedRendererUrls: ['http://localhost:1430/'],
      ipcMain,
      createGrpcClient: async () => { throw new Error('ordinary transport is not used'); },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost,
        localAppAssetMediaHost,
      },
    });
    const { event } = createInvokeEvent();
    const exactEvent = { ...event, senderFrame: { ...event.senderFrame, url: 'http://localhost:1430/' } };
    for (const request of [
      { command: 'nimi.shell.storage.assetRemove', payload: { relativePath: 'media/remove.png' } },
      { command: 'nimi.shell.storage.assetMove', payload: { fromRelativePath: 'media/from.png', toRelativePath: 'media/to.png', overwrite: true } },
      { command: 'nimi.shell.storage.assetAdopt', payload: { artifactId: 'artifact-1', relativePath: 'media/adopt.png', overwrite: true } },
      { command: 'nimi.shell.storage.assetWriteCommit', payload: { streamId: 'write-1' } },
    ]) {
      await expect(invokeBridge(ipcMain, exactEvent, { command: request.command, payload: { payload: request.payload } })).resolves.toBeDefined();
    }
    expect(invalidated).toEqual([
      'media/remove.png', 'media/from.png', 'media/to.png', 'media/adopt.png', 'media/target.png',
    ]);
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

  it('denies undeclared protected Agent commands outside the admitted App surface', async () => {
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
      'registeredAppSubject', 'registrationHandle', 'accountId', 'snapshotId',
      'sourceGeneration', 'declarationGeneration', 'accountGeneration',
      'credential', 'peerProof', 'appOperationId', 'appAccessDomainId', 'classification',
    ]) {
      const { ipcMain, event } = createBridge();
      await expect(invokeBridge(ipcMain, event, {
        command: FINAL_LOCAL_APP_COMMANDS[0],
        payload: { [field]: 'forged' },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
    }
  });
});
