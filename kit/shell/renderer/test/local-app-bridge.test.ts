import { afterEach, describe, expect, it } from 'vitest';
import { createNimiClient } from '@nimiplatform/kit/core/sdk-contract';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

import { createNimiLocalAppStandardShellSurface } from '../src/bridge/index.js';
import { resolveTauriStandardCommand } from '../src/bridge/tauri-api.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('maps text and shared LocalAgent configuration to registered Tauri commands', () => {
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'],
    )).toBe('local_app_text_generate_candidate');
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'],
    )).toBe('local_app_shared_agent_ai_config_get');
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite'],
    )).toBe('local_app_shared_agent_ai_config_overwrite');
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIProfilePreview'],
    )).toBe('local_app_shared_agent_ai_profile_preview');
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIProfileApply'],
    )).toBe('local_app_shared_agent_ai_profile_apply');
  });

  it('maps owner-free App AIConfig operations to exact host commands', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const config = {
      owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }],
    };
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return config;
      },
      listen: () => () => {},
    };
    const aiConfig = createNimiLocalAppStandardShellSurface().aiConfig;
    await expect(aiConfig.get()).resolves.toEqual(config);
    await expect(aiConfig.overwrite(config.capabilities as never)).resolves.toEqual(config);
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.aiConfigGet', payload: {} },
      {
        command: 'nimi.shell.localApp.aiConfigOverwrite',
        payload: { payload: { capabilities: config.capabilities } },
      },
    ]);
    expect(JSON.stringify(invocations)).not.toContain('app.example');
  });

  it('is consumed directly by the SDK without an app-local adapter', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command.endsWith('sessionStatus')) {
          return {
            state: 'ready', reasonCode: 'action-executed', retryable: false,
            currentUser: {
              state: 'ready',
              value: { handle: 'halliday', displayName: 'Halliday', avatarUrl: null },
              reasonCode: 'action-executed', retryable: false,
            },
          };
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
    await expect(client.currentUser.get()).resolves.toEqual({
      handle: 'halliday', displayName: 'Halliday', avatarUrl: null,
    });
  });

  it('projects the exact minimal Agent reference catalog', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return [{
          agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          displayName: 'Agent One',
          avatarUrl: null,
        }];
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().agents.listReferences()).resolves.toEqual([{
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Agent One',
      avatarUrl: null,
    }]);
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.agentReferenceList',
      payload: {},
    }]);
  });

  it('physically omits the retired access-workflow namespace', () => {
    const surface = createNimiLocalAppStandardShellSurface() as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual([
      'session', 'ai', 'aiConfig', 'storage', 'realm', 'agents', 'conversation', 'agentConfigure', 'artifacts',
    ].sort());
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

  it('exposes shared LocalAgent AIConfig/profile beside per-Agent autonomy and presentation', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const config = {
      owner: {
        owner: {
          oneofKind: 'runtimeLocalAgentSubsystem',
          runtimeLocalAgentSubsystem: {},
        },
      },
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }],
    };
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('sharedAgentAIProfilePreview')) return { before: null, after: config };
        if (command.includes('sharedAgentAI')) return config;
        return { revision: '0' };
      },
      listen: () => () => {},
    };
    const configure = createNimiLocalAppStandardShellSurface().agentConfigure;
    const presentationIntent = { backendKind: 'vrm', avatarAssetRef: 'asset-1', expressionProfileRef: '', idlePreset: '', interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false, backgroundAssetRef: '' };
    const profileJson = '{"profileId":"local-gpu"}';
    await expect(configure.sharedAgentAIConfigGet()).resolves.toEqual(config);
    await expect(configure.sharedAgentAIConfigOverwrite(config.capabilities as never)).resolves.toEqual(config);
    await expect(configure.sharedAgentAIProfilePreview(profileJson)).resolves.toEqual({ before: null, after: config });
    await expect(configure.sharedAgentAIProfileApply(profileJson)).resolves.toEqual(config);
    await configure.autonomySnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.updateAutonomy({ agentHandle: 'lash_owner_issued', expectedAutonomyRevision: '1', intent: { enabled: false } });
    await configure.presentationSnapshot({ agentHandle: 'lash_owner_issued' });
    await configure.commitPresentation({ agentHandle: 'lash_owner_issued', expectedPresentationRevision: '0', intent: presentationIntent, importedAssets: [] });
    expect(Object.keys(configure)).toEqual([
      'sharedAgentAIConfigGet', 'sharedAgentAIConfigOverwrite',
      'sharedAgentAIProfilePreview', 'sharedAgentAIProfileApply',
      'autonomySnapshot', 'updateAutonomy', 'presentationSnapshot', 'commitPresentation',
    ]);
    expect(invocations.slice(0, 4)).toEqual([
      { command: 'nimi.shell.localApp.sharedAgentAIConfigGet', payload: {} },
      {
        command: 'nimi.shell.localApp.sharedAgentAIConfigOverwrite',
        payload: { payload: { capabilities: config.capabilities } },
      },
      {
        command: 'nimi.shell.localApp.sharedAgentAIProfilePreview',
        payload: { payload: { profileJson } },
      },
      {
        command: 'nimi.shell.localApp.sharedAgentAIProfileApply',
        payload: { payload: { profileJson } },
      },
    ]);
    expect(JSON.stringify(invocations.slice(0, 4))).not.toMatch(/agentHandle|revision|readiness/u);
    expect(invocations.at(-1)).toEqual({
      command: 'nimi.shell.localApp.agentCommitPresentation',
      payload: { payload: { agentHandle: 'lash_owner_issued', expectedPresentationRevision: '0', intent: presentationIntent, importedAssets: [] } },
    });
  });

  it('rejects shared LocalAgent owner mismatches, owner injection, and malformed profile JSON', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        owner: { owner: { oneofKind: 'app', app: { appId: 'forbidden' } } },
        capabilities: [],
      }),
      listen: () => () => {},
    };
    const configure = createNimiLocalAppStandardShellSurface().agentConfigure;
    await expect(configure.sharedAgentAIConfigGet()).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
    expect(() => configure.sharedAgentAIConfigOverwrite([{ owner: {} }] as never))
      .toThrowError(/authority field owner is forbidden/u);
    expect(() => configure.sharedAgentAIProfilePreview('{'))
      .toThrowError(/profileJson is invalid/u);
  });

  it('sends turn interrupt with only the opaque handle and conversation anchor', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { turnId: 'agent-turn-1' };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().conversation.interruptTurn({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
    })).resolves.toEqual({ turnId: 'agent-turn-1' });
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
          type: 'text-delta',
          conversationAnchorId: 'anchor-1',
          sequence: '1',
          turnId: 'agent-turn-1',
          text: 'hello',
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

  it('sends one exact text-only conversation turn and rejects attachment residue', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { turnId: 'agent-turn-1' };
      },
      listen: () => () => {},
    };
    const conversation = createNimiLocalAppStandardShellSurface().conversation;
    await expect(conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
    })).resolves.toEqual({ turnId: 'agent-turn-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.conversationSendTurn',
      payload: {
        payload: {
          agentHandle: 'lash_owner_issued',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          text: 'hello',
        },
      },
    }]);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
      attachments: [{ artifactId: 'artifact_01J' }],
    } as never)).toThrow(/input fields must be exactly/u);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: '',
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
