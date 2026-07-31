import { describe, expect, it } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  primeNimiElectronLocalAppHost,
  resolveNimiElectronProtectedLocalBindingPackage,
  startNimiElectronLocalAppHostMaintenance,
} from '../src/main/local-app-host.js';
import { vi } from 'vitest';

describe('Electron protected local-app host', () => {
  it('can bootstrap the request-empty session before renderer navigation', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(primeNimiElectronLocalAppHost(host)).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: 'localAppSessionStatus' }]);
  });

  it('rotates the technical session in main and stops maintenance exactly', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const host = createNimiElectronLocalAppHostForBinding(binding(calls));
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000);

      await maintenance.ready;
      expect(calls.map(({ method }) => method)).toEqual(['localAppSessionStatus']);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.map(({ method }) => method)).toEqual([
        'localAppSessionStatus',
        'localAppSessionRenew',
      ]);
      maintenance.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes maintenance and reports one typed failure when rotation fails', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const candidate = {
        ...binding(calls),
        localAppSessionRenew: async () => {
          calls.push({ method: 'localAppSessionRenew' });
          return { status: 'error' as const, reasonCode: 'revoked', retryable: false };
        },
      };
      const host = createNimiElectronLocalAppHostForBinding(candidate);
      const failures: Array<{ reasonCode: string; retryable: boolean }> = [];
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000, (failure) => {
        failures.push(failure);
      });

      await maintenance.ready;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(failures).toEqual([{ reasonCode: 'revoked', retryable: false }]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls.filter(({ method }) => method === 'localAppSessionRenew')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards only session, product permission, exact WorldCore, app-private storage, and typed conversation operations', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    await expect(host.permissionStatus({ permissionId: 'agents.interact' })).resolves.toMatchObject({
      state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
    });
    await expect(host.permissionRequest({ permissionId: 'agents.interact', reason: 'Continue the conversation', requestId: 'permission-request-electron-1' }))
      .resolves.toMatchObject({ state: 'unavailable', permissionId: 'agents.interact', canRequest: false });
    await expect(host.realmWorldCoreList({ take: 20, visibility: 'private' }))
      .resolves.toEqual([{ id: 'world-1', visibility: 'private' }]);
    await expect(host.realmWorldCoreCreate({ core: {}, origin: { kind: 'manual' }, visibility: 'private' }))
      .resolves.toEqual({ id: 'world-2', visibility: 'private' });
    await expect(host.storageReadJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ value: { version: 1 }, sizeBytes: 13 });
    await expect(host.storageWriteJson({ relativePath: 'agent-chat/state.json', value: { version: 2 } }))
      .resolves.toEqual({ value: { version: 2 }, sizeBytes: 13 });
    await expect(host.storageRemoveJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ removed: false });
    await expect(host.conversationOpen({ agentHandle: 'lash_one' }))
      .resolves.toEqual({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null });
    await expect(host.conversationSendTurn({ agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'request-1', text: 'hello' }))
      .resolves.toEqual({ messageId: 'message-1' });
    await expect(host.conversationInterruptTurn({ agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }))
      .resolves.toEqual({ messageId: 'interrupt-message-1' });
    await expect(host.conversationSubscribe({ agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }))
      .resolves.toEqual({ streamId: 'conversation-1' });
    await expect(host.conversationStreamNext({ streamId: 'conversation-1' }))
      .resolves.toEqual({ completed: true });
    await expect(host.conversationStreamClose({ streamId: 'conversation-1' }))
      .resolves.toEqual({ closed: true });
    await expect(host.conversationSnapshot({ agentHandle: 'lash_one', conversationAnchorId: 'anchor-1' }))
      .resolves.toEqual({ anchor: { conversationAnchorId: 'anchor-1' } });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppPermissionStatus',
      'localAppPermissionRequest',
      'localAppRealmWorldCoreList',
      'localAppRealmWorldCoreCreate',
      'localAppStorageReadJson',
      'localAppStorageWriteJson',
      'localAppStorageRemoveJson',
      'localAppConversationOpen',
      'localAppConversationSendTurn',
      'localAppConversationInterruptTurn',
      'localAppConversationSubscribe',
      'localAppConversationStreamNext',
      'localAppConversationStreamClose',
      'localAppConversationSnapshot',
    ]);
  });

  it('preserves closed product permission reasons and rejects unknown native reasons', async () => {
    for (const reasonCode of [
      'permission-unavailable', 'local-app-operation-unavailable', 'request-pending',
      'process-replaced', 'account-changed', 'revoked', 'permission-reserved-not-admitted',
      'permission-unknown', 'agent-ai-config-revision-conflict',
      'agent-autonomy-revision-conflict', 'agent-presentation-revision-conflict',
    ]) {
      const candidate = {
        ...binding([]),
        localAppPermissionStatus: async () => ({ status: 'error' as const, reasonCode, retryable: false }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).permissionStatus({
        permissionId: 'agents.interact',
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
    const unclassified = {
      ...binding([]),
      localAppConversationSendTurn: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-error-unclassified',
        retryable: false,
        reasonMetadata: { grpc_status_code: '13' },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(unclassified).conversationSendTurn({
      agentHandle: 'lash_one',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
    })).rejects.toMatchObject({
      reasonCode: 'runtime-service-error-unclassified',
      retryable: false,
      reasonMetadata: { grpc_status_code: '13' },
    });

    const unknown = {
      ...binding([]),
      localAppPermissionStatus: async () => ({ status: 'error' as const, reasonCode: 'private-detail', retryable: false }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(unknown).permissionStatus({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it('projects the current account Agent handles and allows an empty granted account', async () => {
    const withAgent = {
      ...binding([]),
      localAppPermissionStatus: async () => ({
        status: 'ok' as const,
        value: {
          state: 'granted',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'action-executed',
          agents: [{
            agentHandle: 'lash_one',
            displayName: 'Owned Agent',
            avatarUrl: 'https://assets.example.test/owned-agent.png',
          }],
        },
      }),
      localAppPermissionRequest: async () => ({
        status: 'ok' as const,
        value: {
          state: 'granted',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'action-executed',
          agents: [],
        },
      }),
    };
    const host = createNimiElectronLocalAppHostForBinding(withAgent);
    await expect(host.permissionStatus({ permissionId: 'agents.interact' })).resolves.toMatchObject({
      agents: [{
        agentHandle: 'lash_one',
        displayName: 'Owned Agent',
        avatarUrl: 'https://assets.example.test/owned-agent.png',
      }],
    });
    await expect(host.permissionRequest({
      permissionId: 'agents.interact',
      reason: 'Continue the conversation',
    })).resolves.toMatchObject({ state: 'granted', agents: [] });

    const unstableAvatar = {
      ...withAgent,
      localAppPermissionStatus: async () => ({
        status: 'ok' as const,
        value: {
          state: 'granted',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'action-executed',
          agents: [{
            agentHandle: 'lash_one',
            displayName: 'Owned Agent',
            avatarUrl: 'http://assets.example.test/owned-agent.png',
          }],
        },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(unstableAvatar).permissionStatus({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it('rejects protected authority material returned by the native carrier', async () => {
    const candidate = {
      ...binding([]),
      localAppSessionStatus: async () => ({
        status: 'ok' as const,
        value: { ...statusProjection(), sessionId: 'forbidden' },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).sessionStatus()).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted', retryable: false,
    });
  });

  it('resolves only independently admitted fixed native binding package identities', () => {
    expect(resolveNimiElectronProtectedLocalBindingPackage('win32', 'x64')).toBe(
      '@nimiplatform/kit-protected-local-win32-x64',
    );
    expect(resolveNimiElectronProtectedLocalBindingPackage('darwin', 'arm64')).toBe(
      '@nimiplatform/kit-protected-local-darwin-arm64',
    );
    for (const [platform, architecture] of [['win32', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) {
      expect(() => resolveNimiElectronProtectedLocalBindingPackage(platform, architecture)).toThrow(
        expect.objectContaining({ reasonCode: 'protected-carrier-required', retryable: false }),
      );
    }
  });
});

function statusProjection() {
  return { state: 'ready', reasonCode: 'action-executed', retryable: false };
}

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  const unavailable = {
    state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
    reasonCode: 'local-app-operation-unavailable', agents: [],
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppSessionRenew: record('localAppSessionRenew', statusProjection()),
    localAppPermissionStatus: record('localAppPermissionStatus', unavailable),
    localAppPermissionRequest: record('localAppPermissionRequest', unavailable),
    localAppRealmWorldCoreList: record('localAppRealmWorldCoreList', [{ id: 'world-1', visibility: 'private' }]),
    localAppRealmWorldCoreCreate: record('localAppRealmWorldCoreCreate', { id: 'world-2', visibility: 'private' }),
    localAppStorageReadJson: record('localAppStorageReadJson', { value: { version: 1 }, sizeBytes: 13 }),
    localAppStorageWriteJson: record('localAppStorageWriteJson', { value: { version: 2 }, sizeBytes: 13 }),
    localAppStorageRemoveJson: record('localAppStorageRemoveJson', { removed: false }),
    localAppConversationOpen: record('localAppConversationOpen', {
      conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null,
    }),
    localAppConversationSendTurn: record('localAppConversationSendTurn', { messageId: 'message-1' }),
    localAppConversationInterruptTurn: record('localAppConversationInterruptTurn', { messageId: 'interrupt-message-1' }),
    localAppConversationSubscribe: record('localAppConversationSubscribe', { streamId: 'conversation-1' }),
    localAppConversationStreamNext: record('localAppConversationStreamNext', { completed: true }),
    localAppConversationStreamClose: record('localAppConversationStreamClose', { closed: true }),
    localAppConversationSnapshot: record('localAppConversationSnapshot', {
      anchor: { conversationAnchorId: 'anchor-1' },
    }),
    localAppAgentConfigurationSnapshot: record('localAppAgentConfigurationSnapshot', { configurationRevision: '1' }),
    localAppAgentUpdateConfiguration: record('localAppAgentUpdateConfiguration', { configurationRevision: '2' }),
    localAppAgentReadinessSnapshot: record('localAppAgentReadinessSnapshot', { configurationRevision: '1' }),
    localAppAgentAutonomySnapshot: record('localAppAgentAutonomySnapshot', { autonomyRevision: '1' }),
    localAppAgentUpdateAutonomy: record('localAppAgentUpdateAutonomy', { autonomyRevision: '2' }),
    localAppAgentPresentationSnapshot: record('localAppAgentPresentationSnapshot', { presentationRevision: '0' }),
    localAppAgentCommitPresentation: record('localAppAgentCommitPresentation', { presentationRevision: '1' }),
  };
}
