import { describe, expect, it } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  resolveNimiElectronProtectedLocalBindingPackage,
} from '../src/main/local-app-host.js';

describe('Electron protected local-app host', () => {
  it('forwards only the fourteen typed operations', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    await expect(host.permissionPosture({ operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a' }))
      .resolves.toMatchObject({ state: 'granted' });
    await expect(host.permissionRequest({ operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a', purpose: 'Continue the conversation' }))
      .resolves.toMatchObject({ state: 'pending' });
    await expect(host.artifactsReadRuntimeBytes({ artifactId: 'artifact-a' }))
      .resolves.toMatchObject({ sizeBytes: 8, mimeType: 'text/plain' });
    await expect(host.storageReadJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ value: { version: 1 }, sizeBytes: 13 });
    await expect(host.storageWriteJson({ relativePath: 'agent-chat/state.json', value: { version: 2 } }))
      .resolves.toEqual({ value: { version: 2 }, sizeBytes: 13 });
    await expect(host.storageRemoveJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ removed: false });
    await expect(host.agentInventory())
      .resolves.toMatchObject({ ownerUserId: 'user-a', count: 1 });
    await expect(host.agentOpenConversation({ agentId: 'agent-a', requestedAnchorDisposition: 'create-or-resume' }))
      .resolves.toMatchObject({ conversationAnchorId: 'anchor-a' });
    await expect(host.agentSendTurn({ agentId: 'agent-a', conversationAnchorId: 'anchor-a', clientTurnId: 'turn-a', userText: '你好' }))
      .resolves.toMatchObject({ accepted: true });
    await expect(host.agentSubscribeTurn({ agentId: 'agent-a', conversationAnchorId: 'anchor-a', cursor: '' }))
      .resolves.toMatchObject({ cursor: 'cursor-a' });
    await expect(host.agentGetConversationSnapshot({ agentId: 'agent-a', conversationAnchorId: 'anchor-a' }))
      .resolves.toMatchObject({ conversationAnchorId: 'anchor-a' });
    await expect(host.agentTranscribeVoice({
      agentId: 'agent-a', clientRequestId: 'request-a', audioBase64: 'UklGRg==', mimeType: 'audio/wav',
    })).resolves.toEqual({ clientRequestId: 'request-a', text: '你好' });
    await expect(host.agentSubscribeVoiceStream({
      agentId: 'agent-a', conversationAnchorId: 'anchor-a', turnId: 'turn-a', voiceStreamId: 'voice-a', cursor: '',
    })).resolves.toMatchObject({ cursor: '1', events: [{ voiceStreamId: 'voice-a' }] });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppPermissionPosture',
      'localAppPermissionRequest',
      'localAppArtifactsReadRuntimeBytes',
      'localAppStorageReadJson',
      'localAppStorageWriteJson',
      'localAppStorageRemoveJson',
      'localAppAgentInventory',
      'localAppAgentOpenConversation',
      'localAppAgentSendTurn',
      'localAppAgentSubscribeTurn',
      'localAppAgentGetConversationSnapshot',
      'localAppAgentTranscribeVoice',
      'localAppAgentSubscribeVoiceStream',
    ]);
  });

  it('preserves the closed terminal authorization reasons and rejects unknown native reasons', async () => {
    for (const reasonCode of [
      'no-grant',
      'grant-revoked',
      'grant-superseded',
      'presence-expired',
      'process-replaced',
      'account-changed',
      'revoked',
    ]) {
      const candidate = {
        ...binding([]),
        localAppAgentOpenConversation: async () => ({ status: 'error' as const, reasonCode, retryable: false }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).agentOpenConversation({
        agentId: 'agent-a', requestedAnchorDisposition: 'create-or-resume',
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
    const unknown = {
      ...binding([]),
      localAppAgentOpenConversation: async () => ({ status: 'error' as const, reasonCode: 'private-detail', retryable: false }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(unknown).agentOpenConversation({
      agentId: 'agent-a', requestedAnchorDisposition: 'create-or-resume',
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
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.sessionStatus()).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted',
      retryable: false,
    });
  });

  it('admits only the packaged Windows x64 native binding', () => {
    expect(resolveNimiElectronProtectedLocalBindingPackage('win32', 'x64')).toBe(
      '@nimiplatform/kit-protected-local-win32-x64',
    );
    for (const [platform, architecture] of [['win32', 'arm64'], ['darwin', 'arm64'], ['linux', 'x64']]) {
      expect(() => resolveNimiElectronProtectedLocalBindingPackage(platform, architecture)).toThrow(
        expect.objectContaining({ reasonCode: 'protected-carrier-required', retryable: false }),
      );
    }
  });
});

function statusProjection() {
  return { state: 'zero-grant', reasonCode: 'LOCAL_APP_GRANT_REQUIRED', retryable: false };
}

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppPermissionPosture: record('localAppPermissionPosture', { state: 'granted', reasonCode: 'OK' }),
    localAppPermissionRequest: record('localAppPermissionRequest', { state: 'pending', reasonCode: 'NO_GRANT' }),
    localAppArtifactsReadRuntimeBytes: record('localAppArtifactsReadRuntimeBytes', {
      bytes: new TextEncoder().encode('artifact'),
      mimeType: 'text/plain',
      sizeBytes: 8,
      mimeInferred: false,
    }),
    localAppStorageReadJson: record('localAppStorageReadJson', {
      value: { version: 1 },
      sizeBytes: 13,
    }),
    localAppStorageWriteJson: record('localAppStorageWriteJson', {
      value: { version: 2 },
      sizeBytes: 13,
    }),
    localAppStorageRemoveJson: record('localAppStorageRemoveJson', { removed: false }),
    localAppAgentInventory: record('localAppAgentInventory', {
      ownerUserId: 'user-a',
      count: 1,
      localAgents: [{
        localAgentRef: 'agent-a',
        displayName: 'Agent A',
        ownerUserId: 'user-a',
        runtimeSourceRef: 'source-a',
        sourceReady: true,
      }],
    }),
    localAppAgentOpenConversation: record('localAppAgentOpenConversation', { conversationAnchorId: 'anchor-a' }),
    localAppAgentSendTurn: record('localAppAgentSendTurn', { accepted: true }),
    localAppAgentSubscribeTurn: record('localAppAgentSubscribeTurn', { cursor: 'cursor-a', events: [] }),
    localAppAgentGetConversationSnapshot: record('localAppAgentGetConversationSnapshot', { conversationAnchorId: 'anchor-a', messages: [] }),
    localAppAgentTranscribeVoice: record('localAppAgentTranscribeVoice', { clientRequestId: 'request-a', text: '你好' }),
    localAppAgentSubscribeVoiceStream: record('localAppAgentSubscribeVoiceStream', {
      cursor: '1',
      events: [{
        voiceStreamId: 'voice-a',
        conversationAnchorId: 'anchor-a',
        turnId: 'turn-a',
        streamId: 'stream-a',
        messageId: 'message-a',
        chunkSequence: '1',
        chunkBase64: 'UklGRg==',
        mimeType: 'audio/wav',
        voiceOutputMode: 1,
        playbackTarget: 'zhiyu-chat',
        terminal: false,
        voicePlaybackState: 1,
        terminalReason: '',
        replayTruncated: false,
      }],
    }),
  };
}
