import { describe, expect, it } from 'vitest';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

import { registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

describe('Electron local-app standard-shell operations', () => {
  it('dispatches a typed agent turn without creating an ordinary gRPC client', async () => {
    const ipcMain = new FakeIpcMain();
    const turns: unknown[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'local-app-protected-carrier-only',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: () => { throw new Error('ordinary gRPC must not be constructed'); },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost: localAppHost(turns),
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSendTurn'],
      payload: { payload: { agentId: 'agent-a', conversationAnchorId: 'anchor-a', clientTurnId: 'turn-a', userText: '你好' } },
    })).resolves.toEqual({ accepted: true });
    expect(turns).toEqual([{ agentId: 'agent-a', conversationAnchorId: 'anchor-a', clientTurnId: 'turn-a', userText: '你好' }]);
  });

  it('rejects renderer authority before invoking the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const turns: unknown[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'local-app-protected-carrier-only',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost: localAppHost(turns),
      },
    });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'],
      payload: { payload: { sessionProof: 'forged' } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
    expect(turns).toEqual([]);
  });

  it('routes standard storage commands through the protected host without generic filesystem fallback', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'local-app-protected-carrier-only',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost: localAppHost(calls),
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
      payload: { payload: { relativePath: 'agent-chat/state.json', value: { version: 2 } } },
    })).resolves.toEqual({ value: { version: 2 }, sizeBytes: 13 });
    expect(calls).toContainEqual(['storageWriteJson', {
      relativePath: 'agent-chat/state.json',
      value: { version: 2 },
    }]);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      payload: { payload: { relativePath: '../escape.json' } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
  });
});

function localAppHost(turns: unknown[]) {
  return {
    sessionStatus: async () => ({ state: 'zero-grant', reasonCode: 'LOCAL_APP_GRANT_REQUIRED', retryable: false }),
    permissionPosture: async () => ({ state: 'no-grant' }),
    permissionRequest: async () => ({ state: 'pending' }),
    artifactsReadRuntimeBytes: async () => ({ bytes: new Uint8Array(), mimeType: 'application/octet-stream', sizeBytes: 0, mimeInferred: false }),
    storageReadJson: async (input: unknown) => { turns.push(['storageReadJson', input]); return { value: { version: 1 }, sizeBytes: 13 }; },
    storageWriteJson: async (input: unknown) => { turns.push(['storageWriteJson', input]); return { value: { version: 2 }, sizeBytes: 13 }; },
    storageRemoveJson: async (input: unknown) => { turns.push(['storageRemoveJson', input]); return { removed: true }; },
    agentInventory: async () => ({ ownerUserId: 'user-a', count: 0, localAgents: [] }),
    agentOpenConversation: async () => ({ conversationAnchorId: 'anchor-a' }),
    agentSendTurn: async (input: unknown) => { turns.push(input); return { accepted: true }; },
    agentSubscribeTurn: async () => ({ events: [], cursor: '' }),
    agentGetConversationSnapshot: async () => ({ conversationAnchorId: 'anchor-a', messages: [] }),
  };
}
