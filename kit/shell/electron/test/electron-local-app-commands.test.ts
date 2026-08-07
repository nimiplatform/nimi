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

  it('routes App AIConfig without accepting renderer owner identity', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet'],
      payload: { payload: {} },
    })).resolves.toMatchObject({ capabilities: [] });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite'],
      payload: { payload: { capabilities: [{
        capabilityContract: 'text.generate', requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }] } },
    })).resolves.toMatchObject({ capabilities: [] });
    expect(calls).toEqual([
      ['aiConfigGet'],
      ['aiConfigOverwrite', { capabilities: [{
        capabilityContract: 'text.generate', requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }] }],
    ]);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite'],
      payload: { payload: { capabilities: [{ owner: { appId: 'forged' } }] } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite'],
      payload: { payload: { capabilities: [{
        capabilityContract: 'text.generate', requiredFeatures: [],
        route: {
          oneofKind: 'cloud',
          cloud: {
            implementation: {
              implementationId: 'cloud.text.example', driverId: 'cloud.example', driverDialect: 'v1',
            },
            connectorGrantId: 'grant-forged',
          },
        },
      }] } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toHaveLength(2);
  });

  it('routes only the two exact WorldCore operations without a renderer method selector', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList'],
      payload: { payload: { take: 20, visibility: 'private' } },
    })).resolves.toEqual([{ id: 'world-1' }]);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreCreate'],
      payload: { payload: { core: {}, origin: { kind: 'manual' }, visibility: 'private' } },
    })).resolves.toEqual({ id: 'world-2' });
    expect(calls).toEqual([
      ['realmWorldCoreList', { take: 20, visibility: 'private' }],
      ['realmWorldCoreCreate', { core: {}, origin: { kind: 'manual' }, visibility: 'private' }],
    ]);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList'],
      payload: { payload: { methodId: 'WorldCoreController_listWorldCores' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
  });

  it('routes the exact minimal Agent reference catalog', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentReferenceList'],
      payload: {},
    })).resolves.toEqual([{
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Agent One',
      avatarUrl: null,
    }]);
    expect(calls).toEqual([['agentReferenceList']]);
  });

  it('reaches all five conversation operations but preserves typed failures', async () => {
    const requests = [
      ['local-app.conversationOpen', { agentHandle: 'lash_one' }],
      ['local-app.conversationSendTurn', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'request-1', text: 'hello' }],
      ['local-app.conversationInterruptTurn', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }],
      ['local-app.conversationSubscribe', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }],
      ['local-app.conversationSnapshot', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }],
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

  it('routes the six exact Agent configuration operations through the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    registerBridge(ipcMain, calls);
    const requests = [
      ['local-app.sharedAgentAIConfigGet', {}],
      ['local-app.sharedAgentAIConfigOverwrite', { capabilities: [] }],
      ['local-app.agentAutonomySnapshot', { agentHandle: handle }],
      ['local-app.agentUpdateAutonomy', {
        agentHandle: handle, expectedAutonomyRevision: '2', intent: { enabled: true },
      }],
      ['local-app.agentPresentationSnapshot', { agentHandle: handle }],
      ['local-app.agentCommitPresentation', {
        agentHandle: handle,
        expectedPresentationRevision: '0',
        intent: {
          backendKind: 'vrm', avatarAssetRef: '', expressionProfileRef: '', idlePreset: '',
          interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false,
          backgroundAssetRef: '',
        },
        importedAssets: [{
          role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
          content: [1, 2, 255], sha256: 'abc123',
        }],
      }],
    ] as const;
    for (const [operation, payload] of requests) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS[operation],
        payload: { payload },
      })).resolves.toBeDefined();
    }
    expect(calls).toEqual([
      ['sharedAgentAIConfigGet'],
      ['sharedAgentAIConfigOverwrite', { capabilities: [] }],
      ['agentAutonomySnapshot', { agentHandle: handle }],
      ['agentUpdateAutonomy', {
        agentHandle: handle, expectedAutonomyRevision: '2', intent: { enabled: true },
      }],
      ['agentPresentationSnapshot', { agentHandle: handle }],
      ['agentCommitPresentation', requests[5][1]],
    ]);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'],
      payload: { payload: { agentHandle: handle } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toHaveLength(6);
  });

  it('does not register the retired shared Agent AI profile operations', async () => {
    for (const command of [
      'nimi.shell.localApp.sharedAgentAIProfilePreview',
      'nimi.shell.localApp.sharedAgentAIProfileApply',
    ]) {
      const ipcMain = new FakeIpcMain();
      const calls: unknown[] = [];
      registerBridge(ipcMain, calls);
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: { payload: {} },
      })).rejects.toMatchObject({ code: 'capability-unavailable' });
      expect(calls).toEqual([]);
    }
  });

  it('surfaces unclassified Runtime failures without matching the trust-failure branch', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.thirdparty.fixture',
      runtimeEndpoint: 'local-app-protected-carrier-only',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: () => { throw new Error('ordinary gRPC must not be constructed'); },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        localAppHost: {
          ...localAppHost(calls),
          conversationSendTurn: async () => {
            throw new NimiElectronLocalAppHostError(
              'runtime-service-error-unclassified',
              false,
              { grpc_status_code: '13' },
            );
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'],
      payload: {
        payload: {
          agentHandle: 'lash_one',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: 'hello',
        },
      },
    })).rejects.toMatchObject({
      code: 'runtime-service-error-unclassified',
      reasonCode: 'runtime-service-error-unclassified',
      details: { reasonMetadata: { grpc_status_code: '13' } },
    });
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
      payload: { payload: { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' } },
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

  it('hard-rejects conversation attachments before the carrier', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'],
      payload: {
        payload: {
          agentHandle: 'lash_one',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: 'hello',
          attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
        },
      },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toEqual([]);
  });

  it('rejects empty conversation text before invoking the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'],
      payload: {
        payload: {
          agentHandle: 'lash_one',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: '',
        },
      },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toEqual([]);
  });

  it('does not register Local App artifact operations', async () => {
    for (const command of [
      'nimi.shell.localApp.artifactPut',
      'nimi.shell.localApp.artifactReadBytes',
    ]) {
      const ipcMain = new FakeIpcMain();
      const calls: unknown[] = [];
      registerBridge(ipcMain, calls);
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command,
        payload: { payload: {} },
      })).rejects.toMatchObject({ code: 'capability-unavailable' });
      expect(calls).toEqual([]);
    }
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
    aiConfigGet: async () => {
      calls.push(['aiConfigGet']);
      return { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] };
    },
    aiConfigOverwrite: async (input: unknown) => {
      calls.push(['aiConfigOverwrite', input]);
      return { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] };
    },
    realmWorldCoreList: async (input: unknown) => {
      calls.push(['realmWorldCoreList', input]);
      return [{ id: 'world-1' }];
    },
    realmWorldCoreCreate: async (input: unknown) => {
      calls.push(['realmWorldCoreCreate', input]);
      return { id: 'world-2' };
    },
    storageReadJson: async (input: unknown) => { calls.push(['storageReadJson', input]); return { value: { version: 1 }, sizeBytes: 13 }; },
    storageWriteJson: async (input: unknown) => { calls.push(['storageWriteJson', input]); return { value: { version: 2 }, sizeBytes: 13 }; },
    storageRemoveJson: async (input: unknown) => { calls.push(['storageRemoveJson', input]); return { removed: true }; },
    agentReferenceList: async () => {
      calls.push(['agentReferenceList']);
      return [{
        agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        displayName: 'Agent One',
        avatarUrl: null,
      }];
    },
    sharedAgentAIConfigGet: async () => {
      calls.push(['sharedAgentAIConfigGet']);
      return {
        owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
        capabilities: [],
      };
    },
    sharedAgentAIConfigOverwrite: async (input: unknown) => {
      calls.push(['sharedAgentAIConfigOverwrite', input]);
      return {
        owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
        capabilities: [],
      };
    },
    agentAutonomySnapshot: async (input: unknown) => {
      calls.push(['agentAutonomySnapshot', input]);
      return { enabled: false, config: null, usedTokensInWindow: 0, budgetExhausted: false, autonomyRevision: '1' };
    },
    agentUpdateAutonomy: async (input: unknown) => {
      calls.push(['agentUpdateAutonomy', input]);
      return { enabled: true, config: null, usedTokensInWindow: 0, budgetExhausted: false, autonomyRevision: '2' };
    },
    agentPresentationSnapshot: async (input: unknown) => {
      calls.push(['agentPresentationSnapshot', input]);
      return { profile: null, previousProfile: null, defaultVoiceReference: '', presentationRevision: '0' };
    },
    agentCommitPresentation: async (input: unknown) => {
      calls.push(['agentCommitPresentation', input]);
      return { profile: null, previousProfile: null, defaultVoiceReference: '', presentationRevision: '1' };
    },
    conversationOpen: unavailable('conversationOpen', calls),
    conversationSendTurn: unavailable('conversationSendTurn', calls),
    conversationInterruptTurn: unavailable('conversationInterruptTurn', calls),
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
