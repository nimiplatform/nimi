import { afterEach, describe, expect, it } from 'vitest';
import { createNimiClient } from '@nimiplatform/kit/core/sdk-contract';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

import { createNimiLocalAppStandardShellSurface } from '../src/bridge/index.js';
import { resolveTauriStandardCommand } from '../src/bridge/tauri-api.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('maps text-candidate generation to the registered Tauri command', () => {
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'],
    )).toBe('local_app_text_generate_candidate');
  });

  it('is consumed directly by the SDK without an app-local adapter', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command.endsWith('sessionStatus')) {
          return { state: 'ready', reasonCode: 'action-executed', retryable: false };
        }
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const client = createNimiClient({
      localApp: {
        standardShell: createNimiLocalAppStandardShellSurface(),
      },
    });
    await expect(client.auth.status()).resolves.toMatchObject({
      mode: 'local-app',
      state: 'session-bound',
      reasonCode: 'action-executed',
      retryable: false,
    });
  });

  it('emits only product permission ids and declared request fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return {
          state: 'granted',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'action-executed',
          agents: [{
            agentHandle: 'lash_owner_issued',
            displayName: 'Owned Agent',
            avatarUrl: 'https://assets.example.test/owned-agent.png',
          }],
        };
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface();
    await expect(surface.permission.status({ permissionId: 'agents.interact' })).resolves.toMatchObject({
      state: 'granted',
      agents: [{
        agentHandle: 'lash_owner_issued',
        displayName: 'Owned Agent',
        avatarUrl: 'https://assets.example.test/owned-agent.png',
      }],
    });
    await surface.permission.request({ permissionId: 'agents.interact', reason: 'Continue the conversation', requestId: 'permission-request-renderer-1' });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.permissionStatus',
        payload: { payload: { permissionId: 'agents.interact' } },
      },
      {
        command: 'nimi.shell.localApp.permissionRequest',
        payload: { payload: { permissionId: 'agents.interact', reason: 'Continue the conversation', requestId: 'permission-request-renderer-1' } },
      },
    ]);
    expect(surface).not.toHaveProperty('agent');
  });

  it('rejects a permission reason beyond 240 UTF-8 bytes before host invocation', () => {
    const invocations: unknown[] = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (...args: unknown[]) => { invocations.push(args); return {}; },
      listen: () => () => {},
    };
    expect(() => createNimiLocalAppStandardShellSurface().permission.request({
      permissionId: 'agents.interact',
      reason: '需'.repeat(81),
      requestId: 'permission-request-renderer-long-reason',
    })).toThrowError(/reason is invalid/u);
    expect(invocations).toEqual([]);
  });

  it('forwards one exact bounded text-candidate request', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { text: '  {"name":"Lin"}\n', finishReason: 'stop', traceId: 'trace-1' };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().ai.text.generateCandidate({
      messages: [
        { role: 'system', text: 'Return JSON.' },
        { role: 'user', text: 'Create one persona.' },
      ],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 512,
    })).resolves.toEqual({ text: '  {"name":"Lin"}\n', finishReason: 'stop', traceId: 'trace-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.textGenerateCandidate',
      payload: { payload: {
        messages: [
          { role: 'system', text: 'Return JSON.' },
          { role: 'user', text: 'Create one persona.' },
        ],
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 512,
      } },
    }]);
  });

  it('rejects protected authority material in a permission projection', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        state: 'unavailable',
        permissionId: 'agents.interact',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        agents: [],
        grantId: 'forbidden',
      }),
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().permission.status({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('rejects a non-HTTPS Agent display avatar projection', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        state: 'granted',
        permissionId: 'agents.interact',
        canRequest: false,
        reasonCode: 'ACTION_EXECUTED',
        agents: [{
          agentHandle: 'lash_owner_issued',
          displayName: 'Owned Agent',
          avatarUrl: 'http://assets.example.test/owned-agent.png',
        }],
      }),
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().permission.status({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('projects exact WorldCore list/create commands without transport authority fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return command.endsWith('realmWorldCoreList')
          ? [{ id: 'world-1', visibility: 'private' }]
          : { id: 'world-2', visibility: 'private' };
      },
      listen: () => () => {},
    };
    const worldCore = createNimiLocalAppStandardShellSurface().realm.worldCore;
    await expect(worldCore.list({ take: 20, visibility: 'private' }))
      .resolves.toEqual([{ id: 'world-1', visibility: 'private' }]);
    await expect(worldCore.create({
      core: {},
      origin: { kind: 'manual' },
      visibility: 'private',
    })).resolves.toEqual({ id: 'world-2', visibility: 'private' });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.realmWorldCoreList',
        payload: { payload: { take: 20, visibility: 'private' } },
      },
      {
        command: 'nimi.shell.localApp.realmWorldCoreCreate',
        payload: { payload: { core: {}, origin: { kind: 'manual' }, visibility: 'private' } },
      },
    ]);
    expect(JSON.stringify(invocations)).not.toMatch(/methodId|realmBaseUrl|caller|authorization/u);
  });

  it('exposes exactly nine configure operations and preserves decimal revision strings', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { revision: '0' };
      },
      listen: () => () => {},
    };
    const configure = createNimiLocalAppStandardShellSurface().agentConfigure;
    const intent = { backendKind: 'vrm', avatarAssetRef: 'asset-1', expressionProfileRef: '', idlePreset: '', interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false, backgroundAssetRef: '' };
    const profile = { alias: 'local-gpu' };
    const runtimeDescriptor = { runtimeId: 'local-runtime' };
    await configure.configurationSnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.updateConfiguration({ agentHandle: 'lash_owner_issued', expectedConfigurationRevision: '1', intents: [{ capability: 'text.generate', provider: '', model: 'local/model', routePolicy: 'local' }], profileOrigin: null });
    await configure.readinessSnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.aiProfilePreview({ agentHandle: 'lash_owner_issued', profile, runtimeDescriptor });
    await configure.aiProfileApply({ agentHandle: 'lash_owner_issued', expectedConfigurationRevision: '2', profile, runtimeDescriptor });
    await configure.autonomySnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.updateAutonomy({ agentHandle: 'lash_owner_issued', expectedAutonomyRevision: '1', intent: { enabled: false } });
    await configure.presentationSnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.commitPresentation({ agentHandle: 'lash_owner_issued', expectedPresentationRevision: '0', intent, importedAssets: [] });
    expect(Object.keys(configure)).toEqual([
      'configurationSnapshot', 'updateConfiguration', 'readinessSnapshot', 'aiProfilePreview',
      'aiProfileApply', 'autonomySnapshot', 'updateAutonomy', 'presentationSnapshot', 'commitPresentation',
    ]);
    expect(invocations).toHaveLength(9);
    expect(invocations.slice(3, 5)).toEqual([
      {
        command: 'nimi.shell.localApp.agentAIProfilePreview',
        payload: { payload: { agentHandle: 'lash_owner_issued', profile, runtimeDescriptor } },
      },
      {
        command: 'nimi.shell.localApp.agentAIProfileApply',
        payload: { payload: { agentHandle: 'lash_owner_issued', expectedConfigurationRevision: '2', profile, runtimeDescriptor } },
      },
    ]);
    expect(invocations.at(-1)).toEqual({
      command: 'nimi.shell.localApp.agentCommitPresentation',
      payload: { payload: { agentHandle: 'lash_owner_issued', expectedPresentationRevision: '0', intent, importedAssets: [] } },
    });
  });

  it('sends turn interrupt with only the opaque handle and conversation anchor', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { messageId: 'interrupt-message-1' };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().conversation.interruptTurn({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
    })).resolves.toEqual({ messageId: 'interrupt-message-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.conversationInterruptTurn',
      payload: { payload: { agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1' } },
    }]);
  });

  it('projects conversation events through a cancellable bounded async subscription', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    let unlistenCount = 0;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if ((payload as { payload?: { action?: string } })?.payload?.action === 'cancel') {
          return { subscriptionId: 'conversation-1', closed: true };
        }
        return { subscriptionId: 'conversation-1', eventName: 'local-app-conversation.conversation-1' };
      },
      listen: (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        eventHandler = handler;
        return () => { unlistenCount += 1; };
      },
    };
    const subscription = await createNimiLocalAppStandardShellSurface().conversation.subscribe({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
    });
    const iterator = subscription.events[Symbol.asyncIterator]();
    const next = iterator.next();
    eventHandler?.({
      payload: {
        subscriptionId: 'conversation-1',
        eventType: 'next',
        event: {
          eventType: 1,
          sequence: '1',
          messageId: 'message-1',
          messageType: 'runtime.agent.turn.delta',
          payload: { text: 'hello' },
          reasonCode: 'ACTION_EXECUTED',
          traceId: 'trace-1',
          timestampUnixMs: 123,
        },
      },
    });
    await expect(next).resolves.toMatchObject({ done: false, value: { sequence: '1' } });
    await subscription.cancel();
    await subscription.cancel();
    expect(unlistenCount).toBe(1);
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.conversationSubscribe',
        payload: { payload: { agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1' } },
      },
      {
        command: 'nimi.shell.localApp.conversationSubscribe',
        payload: { payload: { action: 'cancel', subscriptionId: 'conversation-1' } },
      },
    ]);
  });

  it('sends a conversation turn with one exact artifact attachment', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { messageId: 'message-1' };
      },
      listen: () => () => {},
    };
    const conversation = createNimiLocalAppStandardShellSurface().conversation;
    await expect(conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: '',
      attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
    })).resolves.toEqual({ messageId: 'message-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.conversationSendTurn',
      payload: {
        payload: {
          agentHandle: 'lash_owner_issued',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: '',
          attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
        },
      },
    }]);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
      attachments: [{ artifactId: 'a' }, { artifactId: 'b' }],
    })).toThrow(/attachments is invalid/u);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: '',
      attachments: [],
    })).toThrow(/text is invalid/u);
    expect(invocations).toHaveLength(1);
  });

  it('puts artifacts with bounded bytes through the exact artifact command', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { artifactId: 'artifact_01J' };
      },
      listen: () => () => {},
    };
    const artifacts = createNimiLocalAppStandardShellSurface().artifacts;
    const data = new Uint8Array([137, 80, 78, 71]);
    await expect(artifacts.put({
      mimeType: 'image/png',
      displayName: 'photo.png',
      data,
    })).resolves.toEqual({ artifactId: 'artifact_01J' });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe('nimi.shell.localApp.artifactPut');
    const forwarded = (invocations[0]?.payload as { payload: Record<string, unknown> }).payload;
    expect(forwarded.mimeType).toBe('image/png');
    expect(forwarded.displayName).toBe('photo.png');
    expect(forwarded.data).toBeInstanceOf(Uint8Array);
    expect([...(forwarded.data as Uint8Array)]).toEqual([137, 80, 78, 71]);
    expect(() => artifacts.put({
      mimeType: 'image/png',
      displayName: 'photo.png',
      data: new Uint8Array(0),
    })).toThrow(/data is invalid/u);
    expect(() => artifacts.put({
      mimeType: 'image/png',
      displayName: 'photo.png',
      data: new Uint8Array(4 * 1024 * 1024 + 1),
    })).toThrow(/data is invalid/u);
    expect(invocations).toHaveLength(1);
  });

  it('reads artifact bytes through the exact artifact command', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' };
      },
      listen: () => () => {},
    };
    const artifacts = createNimiLocalAppStandardShellSurface().artifacts;
    const result = await artifacts.readBytes({ artifactId: 'artifact_01J' });
    expect(result.mimeType).toBe('image/png');
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect([...result.bytes]).toEqual([137, 80, 78, 71]);
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.artifactReadBytes',
      payload: { payload: { artifactId: 'artifact_01J' } },
    }]);
    expect(() => artifacts.readBytes({ artifactId: '  ' })).toThrow(/artifactId is invalid/u);
    expect(invocations).toHaveLength(1);
  });

  it('carries bounded app-private storage documents without exposing a path or root', async () => {
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
});
