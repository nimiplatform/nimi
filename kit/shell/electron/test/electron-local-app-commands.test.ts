import { describe, expect, it } from 'vitest';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

import {
  NimiElectronLocalAppHostError,
  registerNimiElectronRuntimeBridge,
} from '../src/main/index.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

describe('Electron local-app standard-shell operations', () => {
  it('dispatches product permission status without creating an ordinary gRPC client', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionStatus'],
      payload: { payload: { permissionId: 'agents.interact' } },
    })).resolves.toEqual({
      state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
      reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    });
    expect(calls).toEqual([['permissionStatus', { permissionId: 'agents.interact' }]]);
  });

  it('rejects renderer authority before invoking the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'],
      payload: { payload: { sessionProof: 'forged' } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
    expect(calls).toEqual([]);
  });

  it('rejects a permission reason beyond 240 UTF-8 bytes before invoking the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'],
      payload: { payload: { permissionId: 'agents.interact', reason: '需'.repeat(81) } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
    expect(calls).toEqual([]);
  });

  it('reaches all four conversation operations but preserves reserved typed-unavailable', async () => {
    const requests = [
      ['local-app.conversationOpen', { selectedAgentHandle: 'lash_one', disposition: 'create-new' }],
      ['local-app.conversationSendTurn', { selectedAgentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'request-1', text: 'hello' }],
      ['local-app.conversationSubscribe', { selectedAgentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }],
      ['local-app.conversationSnapshot', { selectedAgentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }],
    ] as const;
    for (const [operation, payload] of requests) {
      const ipcMain = new FakeIpcMain();
      const calls: unknown[] = [];
      registerBridge(ipcMain, calls);
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS[operation],
        payload: { payload },
      })).rejects.toMatchObject({
        code: 'runtime-permission-denied',
        reasonCode: 'local-app-operation-unavailable',
      });
      expect(calls).toHaveLength(1);
    }
  });

  it('cancels a bounded conversation event pump through the subscribe lifecycle command', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    let completeNext: (() => void) | undefined;
    const host = {
      ...localAppHost(calls),
      conversationSubscribe: async (input: unknown) => {
        calls.push(['conversationSubscribe', input]);
        return { streamId: 'conversation-1' };
      },
      conversationStreamNext: async (input: unknown) => {
        calls.push(['conversationStreamNext', input]);
        await new Promise<void>((resolve) => { completeNext = resolve; });
        return { completed: true };
      },
      conversationStreamClose: async (input: unknown) => {
        calls.push(['conversationStreamClose', input]);
        completeNext?.();
        return { closed: true };
      },
    };
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'local-app-protected-carrier-only',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: () => { throw new Error('ordinary gRPC must not be constructed'); },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost: host,
      },
    });
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'];
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command,
      payload: { payload: { selectedAgentHandle: 'lash_one', conversationAnchorId: 'anchor-1' } },
    })).resolves.toEqual({
      subscriptionId: 'conversation-1',
      eventName: 'local-app-conversation.conversation-1',
    });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command,
      payload: { payload: { action: 'cancel', subscriptionId: 'conversation-1' } },
    })).resolves.toEqual({ subscriptionId: 'conversation-1', closed: true });
    expect(calls).toContainEqual(['conversationStreamClose', { streamId: 'conversation-1' }]);
  });

  it('routes app-private storage through the protected host without generic filesystem fallback', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
      payload: { payload: { relativePath: 'agent-chat/state.json', value: { version: 2 } } },
    })).resolves.toEqual({ value: { version: 2 }, sizeBytes: 13 });
    expect(calls).toContainEqual(['storageWriteJson', {
      relativePath: 'agent-chat/state.json', value: { version: 2 },
    }]);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      payload: { payload: { relativePath: '../escape.json' } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
  });
});

function registerBridge(ipcMain: FakeIpcMain, calls: unknown[]) {
  registerNimiElectronRuntimeBridge({
    appId: 'nimi.thirdparty.fixture',
    runtimeEndpoint: 'local-app-protected-carrier-only',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: () => { throw new Error('ordinary gRPC must not be constructed'); },
    standardShellHost: {
      capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      localAppHost: localAppHost(calls),
    },
  });
}

function localAppHost(calls: unknown[]) {
  return {
    sessionStatus: async () => ({ state: 'ready', reasonCode: 'action-executed', retryable: false }),
    permissionStatus: async (input: unknown) => {
      calls.push(['permissionStatus', input]);
      return {
        state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
      };
    },
    permissionRequest: async (input: unknown) => {
      calls.push(['permissionRequest', input]);
      return {
        state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
      };
    },
    storageReadJson: async (input: unknown) => { calls.push(['storageReadJson', input]); return { value: { version: 1 }, sizeBytes: 13 }; },
    storageWriteJson: async (input: unknown) => { calls.push(['storageWriteJson', input]); return { value: { version: 2 }, sizeBytes: 13 }; },
    storageRemoveJson: async (input: unknown) => { calls.push(['storageRemoveJson', input]); return { removed: true }; },
    conversationOpen: unavailable('conversationOpen', calls),
    conversationSendTurn: unavailable('conversationSendTurn', calls),
    conversationSubscribe: unavailable('conversationSubscribe', calls),
    conversationSnapshot: unavailable('conversationSnapshot', calls),
    conversationStreamNext: async () => ({ completed: true }),
    conversationStreamClose: async () => ({ closed: true }),
    renewTechnicalSession: async () => ({ state: 'ready' }),
  };
}

function unavailable(method: string, calls: unknown[]) {
  return async (input: unknown) => {
    calls.push([method, input]);
    throw new NimiElectronLocalAppHostError('local-app-operation-unavailable', false);
  };
}
