import { afterEach, describe, expect, it } from 'vitest';
import { createNimiAppRuntimePlatformClient } from '@nimiplatform/kit/core/sdk-contract';

import {
  createNimiLocalAppStandardShellSurface,
  readNimiLocalAppRuntimeArtifactBytes,
} from '../src/bridge/index.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('is consumed directly by the SDK without an app-local adapter', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command.endsWith('sessionStatus')) {
          return { state: 'zero-grant', reasonCode: 'no-grant', retryable: false };
        }
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const client = createNimiAppRuntimePlatformClient({
      standardShell: createNimiLocalAppStandardShellSurface(),
    });
    await expect(client.auth.status()).resolves.toMatchObject({
      mode: 'local-app',
      state: 'session-bound-zero-grant',
      operationAllowed: false,
    });
  });

  it('emits only the final typed commands and declared payload fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('sessionStatus')) return { state: 'zero-grant', reasonCode: 'LOCAL_APP_GRANT_REQUIRED', retryable: false };
        if (command.endsWith('inventory')) return { ownerUserId: 'user-a', count: 0, localAgents: [] };
        return { accepted: true };
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface();
    await surface.session.status();
    await surface.permission.posture({ operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a' });
    await surface.permission.request({ operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a', purpose: 'Continue the conversation' });
    await surface.agent.inventory();
    await surface.agent.sendTurn({ agentId: 'agent-a', conversationAnchorId: 'anchor-a', clientTurnId: 'turn-a', userText: '你好' });
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.sessionStatus', payload: {} },
      { command: 'nimi.shell.localApp.permissionPosture', payload: { payload: { operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a' } } },
      { command: 'nimi.shell.localApp.permissionRequest', payload: { payload: { operationId: 'runtime-agent.send-turn', resourceRef: 'agent-a', purpose: 'Continue the conversation' } } },
      { command: 'nimi.shell.localApp.agent.inventory', payload: { payload: {} } },
      { command: 'nimi.shell.localApp.agent.sendTurn', payload: { payload: { agentId: 'agent-a', conversationAnchorId: 'anchor-a', clientTurnId: 'turn-a', userText: '你好' } } },
    ]);
  });

  it('rejects malformed artifact projection', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({ dataBase64: 'YQ==', mimeType: 'text/plain', sizeBytes: 2, mimeInferred: false }),
      listen: () => () => {},
    };
    await expect(readNimiLocalAppRuntimeArtifactBytes('artifact-a')).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('carries bounded storage documents without exposing a path or root', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('removeJson')) return { removed: false };
        return { value: { token: 'app-content' }, sizeBytes: 23 };
      },
      listen: () => () => {},
    };
    const storage = createNimiLocalAppStandardShellSurface().storage;
    await expect(storage.writeJson('agent-chat/state.json', { token: 'app-content' })).resolves.toEqual({
      value: { token: 'app-content' },
      sizeBytes: 23,
    });
    await expect(storage.removeJson('agent-chat/state.json')).resolves.toEqual({ removed: false });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.storage.writeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json', value: { token: 'app-content' } } },
      },
      {
        command: 'nimi.shell.storage.removeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json' } },
      },
    ]);
    expect(() => storage.readJson('../escape.json')).toThrow(/relativePath is invalid/u);
  });

  it('projects subscribeTurn as one cursor-bound event pull', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        cursor: '3',
        events: [{
          eventType: 1,
          sequence: '3',
          messageId: 'message-a',
          messageType: 'runtime.agent.turn.text_delta',
          payload: {
            localAgentRef: 'agent-a',
            conversationAnchorId: 'anchor-a',
            turnId: 'turn-a',
            streamId: 'stream-a',
            detail: { textDelta: 'hello' },
          },
          reasonCode: 1,
          traceId: '',
          timestamp: null,
        }],
      }),
      listen: () => () => {},
    };
    const pull = createNimiLocalAppStandardShellSurface().agent.subscribeTurn({
      agentId: 'agent-a',
      conversationAnchorId: 'anchor-a',
    });
    expect(Symbol.asyncIterator in (pull as object)).toBe(false);
    await expect(pull).resolves.toMatchObject({
      cursor: '3',
      events: [{ sequence: '3', messageType: 'runtime.agent.turn.text_delta' }],
    });
  });

  it('rejects cursor or principal-correlation drift in subscribeTurn results', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        cursor: '4',
        events: [{
          eventType: 1,
          sequence: '5',
          messageId: 'message-a',
          messageType: 'runtime.agent.turn.text_delta',
          payload: { localAgentRef: 'other-agent', conversationAnchorId: 'anchor-a' },
          reasonCode: 1,
          traceId: '',
          timestamp: null,
        }],
      }),
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().agent.subscribeTurn({
      agentId: 'agent-a',
      conversationAnchorId: 'anchor-a',
      cursor: '3',
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('carries selected voice operations with exact selectors and bounded bytes', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('transcribeVoice')) {
          return { clientRequestId: 'request-a', text: '你好' };
        }
        return {
          cursor: '1',
          events: [{
            voiceStreamId: 'voice-a', conversationAnchorId: 'anchor-a', turnId: 'turn-a',
            streamId: 'stream-a', messageId: 'message-a', chunkSequence: '1',
            chunkBase64: 'UklGRg==', mimeType: 'audio/wav', voiceOutputMode: 1,
            playbackTarget: 'zhiyu-chat', terminal: false, voicePlaybackState: 1,
            terminalReason: '', replayTruncated: false,
          }],
        };
      },
      listen: () => () => {},
    };
    const agent = createNimiLocalAppStandardShellSurface().agent;
    await expect(agent.transcribeVoice({
      agentId: 'agent-a', clientRequestId: 'request-a', audio: Uint8Array.from([82, 73, 70, 70]), mimeType: 'audio/wav',
    })).resolves.toEqual({ clientRequestId: 'request-a', text: '你好' });
    await expect(agent.subscribeVoiceStream({
      agentId: 'agent-a', conversationAnchorId: 'anchor-a', turnId: 'turn-a', voiceStreamId: 'voice-a',
    })).resolves.toMatchObject({ cursor: '1', events: [{ chunkBase64: 'UklGRg==' }] });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.agent.transcribeVoice',
        payload: { payload: { agentId: 'agent-a', clientRequestId: 'request-a', audioBase64: 'UklGRg==', mimeType: 'audio/wav' } },
      },
      {
        command: 'nimi.shell.localApp.agent.subscribeVoiceStream',
        payload: { payload: { agentId: 'agent-a', conversationAnchorId: 'anchor-a', turnId: 'turn-a', voiceStreamId: 'voice-a', cursor: '' } },
      },
    ]);
  });
});
