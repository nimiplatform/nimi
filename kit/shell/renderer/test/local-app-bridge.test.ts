import { afterEach, describe, expect, it } from 'vitest';
import {
  createNimiClient,
  createNimiLocalAIConfigCapabilityIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

import {
  createNimiLocalAppStandardShellSurface,
  openNimiLocalAppAssetMediaUrl,
} from '../src/bridge/index.js';
import { resolveTauriStandardCommand } from '../src/bridge/tauri-api.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('maps the admitted local-app operations to exact Tauri commands', () => {
    expect(resolveTauriStandardCommand(
      NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'],
    )).toBe('local_app_text_generate_candidate');
    const mappings = [
      ['local-app.modelConfigLocalSelectionsGet', 'local_app_model_config_local_selections_get'],
      ['local-app.sharedAgentAIConfigGet', 'local_app_shared_agent_ai_config_get'],
      ['local-app.sharedAgentAIConfigOverwrite', 'local_app_shared_agent_ai_config_overwrite'],
      ['local-app.agentAutonomySnapshot', 'local_app_agent_autonomy_snapshot'],
      ['local-app.agentUpdateAutonomy', 'local_app_agent_update_autonomy'],
      ['local-app.agentPresentationSnapshot', 'local_app_agent_presentation_snapshot'],
      ['local-app.agentCommitPresentation', 'local_app_agent_commit_presentation'],
      ['local-app.artifactUpload', 'local_app_artifact_upload'],
    ] as const;
    for (const [operation, command] of mappings) {
      expect(resolveTauriStandardCommand(NIMI_STANDARD_SHELL_COMMANDS[operation])).toBe(command);
    }
    for (const command of [
      'nimi.shell.localApp.sharedAgentAIProfilePreview',
      'nimi.shell.localApp.sharedAgentAIProfileApply',
      'nimi.shell.localApp.artifactPut',
    ]) {
      expect(resolveTauriStandardCommand(command)).toBe(command);
    }
  });

  it('maps read-only App AIConfig to the exact host command', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const generatedIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      defaults: { temperature: 0.3 },
    });
    expect(Object.getPrototypeOf(generatedIntent.defaults)).not.toBe(Object.prototype);
    const config = {
      owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
      capabilities: structuredClone([generatedIntent]),
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
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.aiConfigGet', payload: {} },
    ]);
    expect(JSON.stringify(invocations)).not.toContain('app.example');
  });

  it('projects bounded machine selections without configuration identity', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => [{
        capabilityContract: 'text.generate',
        state: 'selected',
        configurationId: null,
        displayName: 'gemma4-26b',
        supportedFeatures: ['input.image'],
        reasons: [],
        effectiveDefaults: { temperature: '0.8' },
      }],
      listen: () => () => {},
    };
    await expect(
      createNimiLocalAppStandardShellSurface().modelConfig.localSelections(),
    ).resolves.toEqual([{
      capabilityContract: 'text.generate',
      state: 'selected',
      configurationId: null,
      displayName: 'gemma4-26b',
      supportedFeatures: ['input.image'],
      reasons: [],
      effectiveDefaults: { temperature: '0.8' },
    }]);

    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => [{
        capabilityContract: 'text.generate',
        state: 'selected',
        configurationId: null,
        displayName: 'gemma4-26b',
        supportedFeatures: [],
        reasons: [],
        effectiveDefaults: { temperature: '界'.repeat(43) },
      }],
      listen: () => () => {},
    };
    await expect(
      createNimiLocalAppStandardShellSurface().modelConfig.localSelections(),
    ).rejects.toThrow('effective defaults are invalid');
  });

  it('exposes typed scenario execution and rejects untrusted projection expansion', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { output: { type: 'text-embed', vectors: [[0.1, 0.2]] }, traceId: 'trace-1' };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().ai.scenario.execute({
      type: 'text-embed', inputs: ['hello'],
    })).resolves.toEqual({ output: { type: 'text-embed', vectors: [[0.1, 0.2]] }, traceId: 'trace-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.scenarioExecute',
      payload: { payload: { spec: { type: 'text-embed', inputs: ['hello'] } } },
    }]);
  });

  it('uploads bounded image bytes through the typed artifact surface', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().ai.artifacts.upload({
      bytes: [1, 2], mimeType: 'image/png',
    })).resolves.toEqual({ artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.artifactUpload',
      payload: { payload: { bytes: [1, 2], mimeType: 'image/png' } },
    }]);
  });

  it('projects canonical voice-create requests, Jobs, and VoiceAsset creation sources', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const asset = {
      voiceAssetId: 'voice-asset-1', creationSource: 'text-description', status: 'active',
      createdAt: null, updatedAt: null, expiresAt: null,
    } as const;
    const voiceReference = { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId } as const;
    const job = {
      jobId: 'job-voice-1', scenarioType: 'voice-create', status: 'submitted',
      progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 1,
      reasonCode: '', reasonDetail: '', artifacts: [], traceId: 'trace-voice-1',
      createdAt: null, updatedAt: null, transcriptionText: '',
    } as const;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit']) return { job };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobGet']) return {
          job: { ...job, status: 'completed', progressPercent: 100, progressCurrentStep: 1 },
          asset,
          voiceReference,
        };
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.voiceAssetsList']) return { assets: [asset], nextPageToken: '' };
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface().ai;
    const spec = {
      type: 'voice-create', creationSource: 'text-description',
      instructionText: 'A clear, calm voice.', previewText: 'Hello.',
      language: 'en', preferredName: 'Calm Voice',
    } as const;
    await expect(surface.scenarioJobs.submit(spec)).resolves.toEqual({ job });
    await expect(surface.scenarioJobs.get(job.jobId)).resolves.toEqual({
      job: { ...job, status: 'completed', progressPercent: 100, progressCurrentStep: 1 },
      asset,
      voiceReference,
    });
    await expect(surface.voiceAssets.list()).resolves.toEqual({ assets: [asset], nextPageToken: '' });
    expect(invocations).toEqual([
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
        payload: { payload: { spec } },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobGet'],
        payload: { payload: { jobId: job.jobId } },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.voiceAssetsList'],
        payload: { payload: { pageSize: 0, pageToken: '' } },
      },
    ]);
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

  it('projects every legal carrier Job event variant through the renderer and SDK', async () => {
    let emit: ((event: { payload: unknown }) => void) | undefined;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubscribe']) {
          return { subscriptionId: 'scenario-job-1', eventName: 'local-app-ai.scenario-job-1' };
        }
        throw new Error(`unexpected command ${command}`);
      },
      listen: (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        emit = handler;
        return () => { emit = undefined; };
      },
    };
    const client = createNimiClient({
      localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
    });
    const subscription = await client.ai.scenarioJobs.subscribe('job-1');
    expect(emit).toBeTypeOf('function');

    const baseJob = {
      jobId: 'job-1', scenarioType: 'video-generate', status: 'submitted',
      progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 4,
      reasonCode: 'unspecified', reasonDetail: '', artifacts: [], traceId: 'trace-1',
      createdAt: null, updatedAt: null, transcriptionText: '',
    };
    const events = [
      { eventType: 'submitted', sequence: '1', traceId: 'trace-1', timestamp: null, job: baseJob },
      { eventType: 'running', sequence: '2', traceId: 'trace-1', timestamp: { seconds: '1786170000', nanos: 1 }, job: {
        ...baseJob, status: 'running', progressPercent: 50, progressCurrentStep: 2,
      } },
      { eventType: 'completed', sequence: '3', traceId: 'trace-1', timestamp: null, job: {
        ...baseJob, status: 'completed', progressPercent: 100, progressCurrentStep: 4,
        artifacts: [{
          artifactId: 'artifact-1', mimeType: 'video/mp4', bytes: [], sizeBytes: 1024,
          sha256: 'abc123', durationMs: 3000, width: 1280, height: 720,
          sampleRateHz: 0, channels: 0,
        }],
      } },
      { eventType: 'failed', sequence: '4', traceId: 'trace-1', timestamp: null, job: {
        ...baseJob, status: 'failed', reasonCode: 'runtime-call-failed',
        reasonDetail: 'provider execution failed',
      } },
    ];
    for (const event of events) {
      emit!({ payload: { subscriptionId: 'scenario-job-1', eventType: 'next', event } });
    }
    emit!({ payload: { subscriptionId: 'scenario-job-1', eventType: 'completed' } });

    const received = [];
    for await (const event of subscription) received.push(event);
    expect(received).toEqual(events);
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

  it('forwards the six exact Agent configuration operations without authority input', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const sharedConfig = {
      owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
      capabilities: [],
    };
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.includes('sharedAgentAIConfig')) return sharedConfig;
        return { autonomyRevision: '2', presentationRevision: '3' };
      },
      listen: () => () => {},
    };
    const configure = createNimiLocalAppStandardShellSurface().agentConfigure;
    await expect(configure.sharedAIConfig.get()).resolves.toEqual(sharedConfig);
    await expect(configure.sharedAIConfig.overwrite([])).resolves.toEqual(sharedConfig);
    await expect(configure.autonomy.snapshot({ agentHandle: handle }))
      .resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
    await expect(configure.autonomy.update({
      agentHandle: handle,
      expectedAutonomyRevision: '2',
      intent: { enabled: true },
    })).resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
    await expect(configure.presentation.snapshot({ agentHandle: handle }))
      .resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
    await expect(configure.presentation.commit({
      agentHandle: handle,
      expectedPresentationRevision: '0',
      intent: {
        backendKind: 'vrm', avatarAssetRef: '', expressionProfileRef: '', idlePreset: '',
        interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false,
        backgroundAssetRef: '',
      },
      importedAssets: [{
        role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
        content: new Uint8Array([1, 2, 255]), sha256: 'abc123',
      }],
    })).resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.sharedAgentAIConfigGet', payload: {} },
      { command: 'nimi.shell.localApp.sharedAgentAIConfigOverwrite', payload: { payload: { capabilities: [] } } },
      { command: 'nimi.shell.localApp.agentAutonomySnapshot', payload: { payload: { agentHandle: handle } } },
      {
        command: 'nimi.shell.localApp.agentUpdateAutonomy',
        payload: { payload: { agentHandle: handle, expectedAutonomyRevision: '2', intent: { enabled: true } } },
      },
      { command: 'nimi.shell.localApp.agentPresentationSnapshot', payload: { payload: { agentHandle: handle } } },
      {
        command: 'nimi.shell.localApp.agentCommitPresentation',
        payload: { payload: {
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
        } },
      },
    ]);
    expect(JSON.stringify(invocations)).not.toMatch(/sessionId|appId|agentId/u);
  });

  it('physically omits the retired access-workflow namespace', () => {
    const surface = createNimiLocalAppStandardShellSurface() as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual([
      'session', 'ai', 'aiConfig', 'modelConfig', 'storage', 'realm', 'agents', 'agentConfigure', 'conversation',
    ].sort());
    expect(Object.keys(surface.agentConfigure as Record<string, unknown>).sort()).toEqual([
      'sharedAIConfig', 'autonomy', 'presentation',
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
      temperature: 0,
      topP: 0,
      maxTokens: 0,
      topK: 0,
      presencePenalty: -2,
      frequencyPenalty: 2,
      stop: ['END'],
      seed: 0,
    })).resolves.toEqual({ text: '  {"name":"Lin"}\n', finishReason: 'stop', traceId: 'trace-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.textGenerateCandidate',
      payload: { payload: {
        messages: [
          { role: 'system', text: 'Return JSON.' },
          { role: 'user', text: 'Create one persona.' },
        ],
        temperature: 0,
        topP: 0,
        maxTokens: 0,
        topK: 0,
        presencePenalty: -2,
        frequencyPenalty: 2,
        stop: ['END'],
        seed: 0,
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

  it('streams managed asset writes and reads with bounded chunks and cancellation', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const asset = {
      relativePath: 'media/generated.png', mediaType: 'image/png', sizeBytes: 1_048_579,
      sha256: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    };
    let readNext = 0;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('assetWriteOpen')) return { streamId: 'write-1' };
        if (command.endsWith('assetWriteChunk')) return { accepted: true };
        if (command.endsWith('assetWriteCommit')) return asset;
        if (command.endsWith('assetWriteAbort')) return { aborted: true };
        if (command.endsWith('assetStat')) return asset;
        if (command.endsWith('assetList')) return { assets: [asset], nextCursor: '' };
        if (command.endsWith('assetReadOpen')) return {
          streamId: 'read-1', asset: { ...asset, sizeBytes: 4 }, range: { offset: 0, length: 4, totalSize: 4 },
        };
        if (command.endsWith('assetReadNext')) {
          readNext += 1;
          return readNext === 1
            ? { completed: false, bodyChunk: Uint8Array.from([1, 2]) }
            : { completed: false, bodyChunk: Uint8Array.from([3, 4]) };
        }
        if (command.endsWith('assetReadClose')) return { closed: true };
        throw new Error(`unexpected command: ${command}`);
      },
      listen: () => () => {},
    };
    const assets = createNimiLocalAppStandardShellSurface().storage.assets;
    const body = new Uint8Array(1_048_579);
    await expect(assets.write({ relativePath: asset.relativePath, mediaType: 'image/png', body })).resolves.toEqual(asset);
    const chunkCalls = invocations.filter(({ command }) => command.endsWith('assetWriteChunk'));
    expect(chunkCalls.map(({ payload }) => (
      payload as { payload: { bodyChunk: Uint8Array } }
    ).payload.bodyChunk.byteLength)).toEqual([1_048_576, 3]);

    const read = await assets.read({ relativePath: asset.relativePath });
    for await (const chunk of read.body) {
      expect(chunk).toEqual(Uint8Array.from([1, 2]));
      break;
    }
    expect(invocations.some(({ command }) => command.endsWith('assetReadClose'))).toBe(true);
    const unicodePath = '媒体/é.wav';
    const maximumPath = `${'a'.repeat(255)}/${'b'.repeat(255)}/${'c'.repeat(255)}/${'d'.repeat(254)}/e`;
    await expect(assets.stat(unicodePath)).resolves.toEqual(asset);
    await expect(assets.stat(maximumPath)).resolves.toEqual(asset);
    await expect(assets.list({ prefix: '媒体/', pageSize: 500 })).resolves.toEqual({ assets: [asset], nextCursor: '' });
    expect(() => assets.stat('媒体/e\u0301.wav')).toThrow(/relativePath is invalid/u);
    expect(() => assets.stat(`${maximumPath}x`)).toThrow(/relativePath is invalid/u);
    expect(() => assets.list({ prefix: '媒体/', pageSize: 501 })).toThrow(/page is invalid/u);
    const visibleKeys = invocations.flatMap(({ payload }) => {
      const outer = payload && typeof payload === 'object' ? Object.keys(payload) : [];
      const nested = (payload as { payload?: unknown })?.payload;
      return [...outer, ...(nested && typeof nested === 'object' ? Object.keys(nested) : [])];
    });
    expect(visibleKeys.join('|')).not.toMatch(/account|subject|endpoint|proof|base64/iu);
  });

  it('aborts failed asset writes and returns only an opaque revocable playback URL', async () => {
    const invocations: string[] = [];
    const handle = 'A'.repeat(43);
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        invocations.push(command);
        if (command.endsWith('assetWriteOpen')) return { streamId: 'write-2' };
        if (command.endsWith('assetWriteChunk')) throw new Error('stream canceled');
        if (command.endsWith('assetWriteAbort')) return { aborted: true };
        if (command.endsWith('assetMediaOpen')) return { handle, url: `nimi-app-asset://media/${handle}` };
        if (command.endsWith('assetMediaRevoke')) return { revoked: true };
        throw new Error(`unexpected command: ${command}`);
      },
      listen: () => () => {},
    };
    const assets = createNimiLocalAppStandardShellSurface().storage.assets;
    await expect(assets.write({ relativePath: 'media/fail.png', body: Uint8Array.from([1]) })).rejects.toThrow('stream canceled');
    expect(invocations.slice(0, 3)).toEqual([
      'nimi.shell.storage.assetWriteOpen',
      'nimi.shell.storage.assetWriteChunk',
      'nimi.shell.storage.assetWriteAbort',
    ]);

    const media = await openNimiLocalAppAssetMediaUrl('media/generated.png');
    expect(media.url).toBe(`nimi-app-asset://media/${handle}`);
    expect(media.url).not.toContain('nimi-shell-file');
    await media.revoke();
    await media.revoke();
    expect(invocations.filter((command) => command.endsWith('assetMediaRevoke'))).toHaveLength(1);
  });
});
