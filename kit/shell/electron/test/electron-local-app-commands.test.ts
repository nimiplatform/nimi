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

  it('reaches all five conversation operations but preserves typed failures', async () => {
    const requests = [
      ['local-app.conversationOpen', { agentHandle: 'lash_one' }],
      ['local-app.conversationSendTurn', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'request-1', text: 'hello', attachments: [] }],
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

  it('routes shared LocalAgent AIConfig/profile and per-Agent autonomy/presentation exactly', async () => {
    const profileJson = '{"profileId":"local-gpu"}';
    const requests = [
      ['local-app.sharedAgentAIConfigGet', {}],
      ['local-app.sharedAgentAIConfigOverwrite', { capabilities: [{
        capabilityContract: 'text.generate', requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }] }],
      ['local-app.sharedAgentAIProfilePreview', { profileJson }],
      ['local-app.sharedAgentAIProfileApply', { profileJson }],
      ['local-app.agentAutonomySnapshot', { agentHandle: 'lash_one' }],
      ['local-app.agentUpdateAutonomy', { agentHandle: 'lash_one', expectedAutonomyRevision: '1', intent: { enabled: false } }],
      ['local-app.agentPresentationSnapshot', { agentHandle: 'lash_one' }],
      ['local-app.agentCommitPresentation', { agentHandle: 'lash_one', expectedPresentationRevision: '0', intent: { backendKind: 'vrm', avatarAssetRef: 'asset-1', expressionProfileRef: '', idlePreset: '', interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false, backgroundAssetRef: '' }, importedAssets: [] }],
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
      expect(JSON.stringify(calls)).not.toMatch(/ownerUserId|runtimeSourceRef|localAgentRef|accountId/u);
    }
  });

  it('rejects malformed shared profile JSON and shared config owner injection before host invocation', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIProfilePreview'],
      payload: { payload: { profileJson: '{' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite'],
      payload: { payload: { capabilities: [{ appId: 'forged' }] } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toEqual([]);
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
          attachments: [],
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

  it('forwards one exact turn attachment and admits attachment-only text before the carrier', async () => {
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
          attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
        },
      },
    })).rejects.toMatchObject({ reasonCode: 'local-app-operation-unavailable' });
    expect(calls).toEqual([['conversationSendTurn', {
      agentHandle: 'lash_one',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: '',
      attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
    }]]);
  });

  it('rejects malformed turn attachments before invoking the protected host', async () => {
    const invalidAttachments: unknown[] = [
      'artifact_01J',
      [{ artifactId: 'a' }, { artifactId: 'b' }],
      [{ artifactId: '' }],
      [{ artifactId: 'a', mimeType: 'image/png' }],
      [{ artifactId: 'a', displayName: 7 }],
    ];
    for (const attachments of invalidAttachments) {
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
            attachments,
          },
        },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
      expect(calls).toEqual([]);
    }
    const emptyTurn = new FakeIpcMain();
    const emptyCalls: unknown[] = [];
    registerBridge(emptyTurn, emptyCalls);
    await expect(invokeBridge(emptyTurn, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'],
      payload: {
        payload: {
          agentHandle: 'lash_one',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: '',
          attachments: [],
        },
      },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(emptyCalls).toEqual([]);
  });

  it('routes artifact byte reads with an exact artifact id and rejects malformed ids', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactReadBytes'],
      payload: { payload: { artifactId: 'artifact_01J' } },
    })).rejects.toMatchObject({ reasonCode: 'local-app-operation-unavailable' });
    expect(calls).toEqual([['artifactReadBytes', { artifactId: 'artifact_01J' }]]);

    const rejectingIpcMain = new FakeIpcMain();
    const rejectingCalls: unknown[] = [];
    registerBridge(rejectingIpcMain, rejectingCalls);
    await expect(invokeBridge(rejectingIpcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactReadBytes'],
      payload: { payload: { artifactId: '  ' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    await expect(invokeBridge(rejectingIpcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactReadBytes'],
      payload: { payload: { artifactId: 'artifact_01J', ownerUserId: 'forged' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(rejectingCalls).toEqual([]);
  });

  it('routes artifact puts with bounded bytes and rejects malformed uploads', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactPut'],
      payload: {
        payload: {
          mimeType: 'image/png',
          displayName: 'photo.png',
          data: new Uint8Array([137, 80, 78, 71]),
        },
      },
    })).rejects.toMatchObject({ reasonCode: 'local-app-operation-unavailable' });
    expect(calls).toHaveLength(1);
    const [method, forwarded] = calls[0] as [string, { mimeType: string; displayName: string; data: Uint8Array }];
    expect(method).toBe('artifactPut');
    expect(forwarded.mimeType).toBe('image/png');
    expect(forwarded.displayName).toBe('photo.png');
    expect(forwarded.data).toBeInstanceOf(Uint8Array);
    expect([...forwarded.data]).toEqual([137, 80, 78, 71]);

    const invalidPayloads: unknown[] = [
      { mimeType: '', displayName: 'photo.png', data: new Uint8Array([1]) },
      { mimeType: 'image/png', displayName: 'photo.png ', data: new Uint8Array([1]) },
      { mimeType: 'image/png', displayName: 'photo.png', data: new Uint8Array(0) },
      { mimeType: 'image/png', displayName: 'photo.png', data: [1, 2, 3] },
      { mimeType: 'image/png', displayName: 'photo.png' },
    ];
    for (const payload of invalidPayloads) {
      const rejectingIpcMain = new FakeIpcMain();
      const rejectingCalls: unknown[] = [];
      registerBridge(rejectingIpcMain, rejectingCalls);
      await expect(invokeBridge(rejectingIpcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactPut'],
        payload: { payload },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
      expect(rejectingCalls).toEqual([]);
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
    conversationOpen: unavailable('conversationOpen', calls),
    conversationSendTurn: unavailable('conversationSendTurn', calls),
    conversationInterruptTurn: unavailable('conversationInterruptTurn', calls),
    conversationSubscribe: unavailable('conversationSubscribe', calls),
    conversationSnapshot: unavailable('conversationSnapshot', calls),
    artifactPut: unavailable('artifactPut', calls),
    artifactReadBytes: unavailable('artifactReadBytes', calls),
    sharedAgentAIConfigGet: unavailable('sharedAgentAIConfigGet', calls),
    sharedAgentAIConfigOverwrite: unavailable('sharedAgentAIConfigOverwrite', calls),
    sharedAgentAIProfilePreview: unavailable('sharedAgentAIProfilePreview', calls),
    sharedAgentAIProfileApply: unavailable('sharedAgentAIProfileApply', calls),
    agentAutonomySnapshot: unavailable('agentAutonomySnapshot', calls),
    agentUpdateAutonomy: unavailable('agentUpdateAutonomy', calls),
    agentPresentationSnapshot: unavailable('agentPresentationSnapshot', calls),
    agentCommitPresentation: unavailable('agentCommitPresentation', calls),
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
