import { describe, expect, it, vi } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  primeNimiElectronLocalAppHost,
  resolveNimiElectronProtectedLocalBindingPackage,
  startNimiElectronLocalAppHostMaintenance,
} from '../src/main/local-app-host.js';

describe('Electron protected local-app host', () => {
  it('bootstraps and rotates only the request-empty technical session', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const host = createNimiElectronLocalAppHostForBinding(binding(calls));
      await expect(primeNimiElectronLocalAppHost(host)).resolves.toBeUndefined();
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000);
      await maintenance.ready;
      await vi.advanceTimersByTimeAsync(1_000);
      maintenance.close();
      expect(calls.map(({ method }) => method)).toEqual([
        'localAppSessionStatus',
        'localAppSessionStatus',
        'localAppSessionRenew',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('physically omits the retired access-workflow namespace', () => {
    const host = createNimiElectronLocalAppHostForBinding(binding([])) as unknown as Record<string, unknown>;
    expect(Object.keys(host)).not.toContain('permission');
    expect(Object.keys(host).some((key) => /request|grant|revoke/iu.test(key))).toBe(false);
  });

  it('forwards exact WorldCore, app-private storage, and typed conversation operations', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    await expect(host.realmWorldCoreList({ take: 20, visibility: 'private' }))
      .resolves.toEqual([{ id: 'world-1', visibility: 'private' }]);
    await expect(host.storageReadJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ value: { version: 1 }, sizeBytes: 13 });
    await expect(host.conversationOpen({ agentHandle: 'lash_one' }))
      .resolves.toEqual({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null });
    await expect(host.artifactReadBytes({ artifactId: 'artifact_01J' }))
      .resolves.toMatchObject({ mimeType: 'image/png' });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppRealmWorldCoreList',
      'localAppStorageReadJson',
      'localAppConversationOpen',
      'localAppArtifactReadBytes',
    ]);
  });

  it('performs one bounded same-Host rebind on typed session invalidation', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    let attempts = 0;
    const candidate = {
      ...binding(calls),
      localAppSessionRenew: async () => {
        calls.push({ method: 'localAppSessionRenew' });
        return { status: 'ok' as const, value: statusProjection() };
      },
      localAppStorageReadJson: async (input: unknown) => {
        calls.push({ method: 'localAppStorageReadJson', input });
        attempts++;
        return attempts === 1
          ? { status: 'error' as const, reasonCode: 'account-changed', retryable: false }
          : { status: 'error' as const, reasonCode: 'local-app-owner-unavailable', retryable: false };
      },
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.storageReadJson({ relativePath: 'state.json' })).rejects.toMatchObject({
      reasonCode: 'local-app-owner-unavailable', retryable: false,
    });
    expect(calls).toEqual([
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
      { method: 'localAppSessionRenew' },
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
    ]);
  });

  it('does not disguise access denial as rebind or owner unavailability', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const candidate = {
      ...binding(calls),
      localAppStorageReadJson: async (input: unknown) => {
        calls.push({ method: 'localAppStorageReadJson', input });
        return { status: 'error' as const, reasonCode: 'local-app-access-denied', retryable: false };
      },
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).storageReadJson({
      relativePath: 'state.json',
    })).rejects.toMatchObject({ reasonCode: 'local-app-access-denied', retryable: false });
    expect(calls).toEqual([
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
    ]);
  });

  it('preserves typed unavailable errors without leaking native detail', async () => {
    const candidate = {
      ...binding([]),
      localAppConversationSendTurn: async () => ({
        status: 'error' as const,
        reasonCode: 'local-app-operation-unavailable',
        retryable: false,
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).conversationSendTurn({
      agentHandle: 'lash_one',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
    })).rejects.toMatchObject({ reasonCode: 'local-app-operation-unavailable', retryable: false });
  });

  it('rejects protected carrier material returned by the native binding', async () => {
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

function sharedAgentConfig() {
  return {
    owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
    capabilities: [],
  };
}

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppSessionRenew: record('localAppSessionRenew', statusProjection()),
    localAppAIConfigGet: record('localAppAIConfigGet', { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] }),
    localAppAIConfigOverwrite: record('localAppAIConfigOverwrite', { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] }),
    localAppSharedAgentAIConfigGet: record('localAppSharedAgentAIConfigGet', sharedAgentConfig()),
    localAppSharedAgentAIConfigOverwrite: record('localAppSharedAgentAIConfigOverwrite', sharedAgentConfig()),
    localAppSharedAgentAIProfilePreview: record('localAppSharedAgentAIProfilePreview', { before: null, after: sharedAgentConfig() }),
    localAppSharedAgentAIProfileApply: record('localAppSharedAgentAIProfileApply', sharedAgentConfig()),
    localAppTextGenerateCandidate: record('localAppTextGenerateCandidate', { text: 'hello', finishReason: 'stop', traceId: 'trace-1' }),
    localAppRealmWorldCoreList: record('localAppRealmWorldCoreList', [{ id: 'world-1', visibility: 'private' }]),
    localAppRealmWorldCoreCreate: record('localAppRealmWorldCoreCreate', { id: 'world-2', visibility: 'private' }),
    localAppStorageReadJson: record('localAppStorageReadJson', { value: { version: 1 }, sizeBytes: 13 }),
    localAppStorageWriteJson: record('localAppStorageWriteJson', { value: { version: 2 }, sizeBytes: 13 }),
    localAppStorageRemoveJson: record('localAppStorageRemoveJson', { removed: false }),
    localAppConversationOpen: record('localAppConversationOpen', { conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
    localAppConversationSendTurn: record('localAppConversationSendTurn', { messageId: 'message-1' }),
    localAppConversationInterruptTurn: record('localAppConversationInterruptTurn', { messageId: 'interrupt-message-1' }),
    localAppConversationSubscribe: record('localAppConversationSubscribe', { streamId: 'conversation-1' }),
    localAppConversationStreamNext: record('localAppConversationStreamNext', { completed: true }),
    localAppConversationStreamClose: record('localAppConversationStreamClose', { closed: true }),
    localAppConversationSnapshot: record('localAppConversationSnapshot', { anchor: { conversationAnchorId: 'anchor-1' } }),
    localAppArtifactPut: record('localAppArtifactPut', { artifactId: 'artifact_01J' }),
    localAppArtifactReadBytes: record('localAppArtifactReadBytes', { bytes: new Uint8Array([1]), mimeType: 'image/png' }),
    localAppAgentAutonomySnapshot: record('localAppAgentAutonomySnapshot', { autonomyRevision: '1' }),
    localAppAgentUpdateAutonomy: record('localAppAgentUpdateAutonomy', { autonomyRevision: '2' }),
    localAppAgentPresentationSnapshot: record('localAppAgentPresentationSnapshot', { presentationRevision: '0' }),
    localAppAgentCommitPresentation: record('localAppAgentCommitPresentation', { presentationRevision: '1' }),
  };
}
