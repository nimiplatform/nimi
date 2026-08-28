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
      ['local-app.aiConfigOverwrite', 'local_app_ai_config_overwrite'],
      ['local-app.aiConfigLocalOptions', 'local_app_ai_config_local_options'],
      ['local-app.sharedAgentAIConfigGet', 'local_app_shared_agent_ai_config_get'],
      ['local-app.sharedAgentAIConfigOverwrite', 'local_app_shared_agent_ai_config_overwrite'],
      ['local-app.sharedAgentAIConfigLocalOptions', 'local_app_shared_agent_ai_config_local_options'],
      ['local-app.agentManagerSnapshot', 'local_app_agent_manager_snapshot'],
      ['local-app.agentAutonomySnapshot', 'local_app_agent_autonomy_snapshot'],
      ['local-app.agentUpdateAutonomy', 'local_app_agent_update_autonomy'],
      ['local-app.agentPresentationSnapshot', 'local_app_agent_presentation_snapshot'],
      ['local-app.agentCommitPresentation', 'local_app_agent_commit_presentation'],
      ['local-app.agentMemoryInspect', 'local_app_agent_memory_inspect'],
      ['local-app.agentMemoryCorrect', 'local_app_agent_memory_correct'],
      ['local-app.agentMemoryForget', 'local_app_agent_memory_forget'],
      ['local-app.agentMemorySwitch', 'local_app_agent_memory_switch'],
      ['local-app.agentMemoryDelete', 'local_app_agent_memory_delete'],
      ['local-app.artifactUpload', 'local_app_artifact_upload'],
      ['local-app.realmWorldCoreList', 'local_app_realm_world_core_list'],
      ['local-app.realmWorldCoreCreate', 'local_app_realm_world_core_create'],
      ['local-app.realmPersonaCharacterListOwned', 'local_app_persona_character_list_owned'],
      ['local-app.realmPersonaCharacterGetOwned', 'local_app_persona_character_get_owned'],
      ['local-app.realmPersonaCharacterCreate', 'local_app_persona_character_create'],
      ['local-app.realmPersonaCharacterReplace', 'local_app_persona_character_replace'],
      ['local-app.realmPersonaCharacterDelete', 'local_app_persona_character_delete'],
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

  it('maps the canonical App AIConfig manager to exact host commands', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const generatedIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      loadoutRef: 'loadout-text',
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
        return { config, revision: '1', effectiveSelections: [] };
      },
      listen: () => () => {},
    };
    const aiConfig = createNimiLocalAppStandardShellSurface().aiConfig;
    await expect(aiConfig.get()).resolves.toEqual({ config, revision: '1', effectiveSelections: [] });
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.aiConfigGet', payload: {} },
    ]);
    expect(JSON.stringify(invocations)).not.toContain('app.example');
  });

  it('projects Cloud target options as JSON at the renderer boundary', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        kind: 'cloud-targets',
        options: [{
          connectorRef: 'connector-deepseek',
          label: 'deepseek-v4-flash',
          capabilityContract: 'text.generate',
          implementation: {
            implementationId: 'deepseek',
            driverId: 'nimillm',
            driverDialect: 'deepseek',
          },
          providerModelTarget: {
            fields: {
              provider: { kind: { oneofKind: 'stringValue', stringValue: 'deepseek' } },
              providerModelId: { kind: { oneofKind: 'stringValue', stringValue: 'deepseek-v4-flash' } },
              remoteModelCatalogId: { kind: { oneofKind: 'stringValue', stringValue: 'catalog-deepseek-v4-flash' } },
            },
          },
          supportedFeatures: [],
          state: 'ready',
          reasons: [],
        }],
        truncated: false,
      }),
      listen: () => () => {},
    };

    const result = await createNimiLocalAppStandardShellSurface().aiConfig.listOptions({
      kind: 'cloud-targets',
      capabilityContract: 'text.generate',
      connectorRef: 'connector-deepseek',
    });

    expect(result.options[0]?.providerModelTarget).toEqual({
      provider: 'deepseek',
      providerModelId: 'deepseek-v4-flash',
      remoteModelCatalogId: 'catalog-deepseek-v4-flash',
    });
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

  it('forwards the typed artifact-owned image reference without another carrier', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return { output: { type: 'image-generate', artifacts: [] }, traceId: 'trace-image-1' };
      },
      listen: () => () => {},
    };
    const spec = {
      type: 'image-generate', prompt: 'edit the portrait', negativePrompt: '',
      size: '', aspectRatio: '', quality: '', style: '',
      referenceImages: [], referenceImageArtifactId: 'artifact-image-source-1',
      mask: '', responseFormat: '',
    } as const;

    await expect(createNimiLocalAppStandardShellSurface().ai.scenario.execute(spec)).resolves.toEqual({
      output: { type: 'image-generate', artifacts: [] }, traceId: 'trace-image-1',
    });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.scenarioExecute',
      payload: { payload: { spec } },
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
        payload: { payload: { spec, timeoutMs: 0 } },
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

  it('projects the protected Music Job case through the renderer bridge', async () => {
    const job = {
      jobId: 'job-music-1', scenarioType: 'music-generate', status: 'submitted',
      progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
      reasonCode: 'ACTION_EXECUTED', reasonDetail: '', artifacts: [], traceId: 'trace-music-1',
      createdAt: null, updatedAt: null, transcriptionText: '',
    } as const;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command === NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit']) return { job };
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface().ai;
    await expect(surface.scenarioJobs.submit({
      type: 'music-generate', prompt: 'bright synth-pop', lyrics: '[Verse]\nCity lights.',
    })).resolves.toEqual({ job });
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

  it('forwards the canonical Agent configuration operations without authority input', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const sharedConfig = {
      owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
      capabilities: [],
    };
    const participation = [
      { role: 'conversation.primary', capabilityContract: 'text.generate' },
      { role: 'memory.embedding', capabilityContract: 'text.embed' },
      { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
      { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
      { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
      { role: 'conversation.action.image', capabilityContract: 'image.generate' },
    ];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('sharedAgentAIConfigGet')) {
          return { config: sharedConfig, revision: '1', effectiveSelections: [], participation };
        }
        if (command.endsWith('sharedAgentAIConfigOverwrite')) {
          return {
            outcome: 'committed', config: sharedConfig, revision: '1',
            effectiveSelections: [], reasonCode: 'REASON_CODE_UNSPECIFIED',
            participation,
          };
        }
        if (command.endsWith('sharedAgentAIConfigLocalOptions')) {
          const query = payload as { kind?: string };
          if (query.kind === 'preset-voices') {
            return {
              kind: 'preset-voices', truncated: false,
              options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
            };
          }
          return { kind: 'local-loadouts', options: [], truncated: false };
        }
        return { autonomyRevision: '2', presentationRevision: '3' };
      },
      listen: () => () => {},
    };
    const configure = createNimiLocalAppStandardShellSurface().agentConfigure;
    await expect(configure.sharedAIConfig.get()).resolves.toEqual({ config: sharedConfig, revision: '1', effectiveSelections: [], participation });
    await expect(configure.sharedAIConfig.overwrite({ expectedRevision: '0', capabilities: [] }))
      .resolves.toEqual({ outcome: 'committed', config: sharedConfig, revision: '1', participation });
    await expect(configure.sharedAIConfig.listOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate' }))
      .resolves.toEqual({ kind: 'local-loadouts', options: [], truncated: false });
    await expect(configure.sharedAIConfig.listOptions({ kind: 'preset-voices' }))
      .resolves.toEqual({
        kind: 'preset-voices', truncated: false,
        options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
      });
    await expect(configure.manager.snapshot({ agentHandle: handle, conversationAnchorId: 'anchor-1' }))
      .resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
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
      intent: { defaultVoiceReference: 'preset_voice_id:serena' },
      importedAssets: [],
    })).resolves.toEqual({ autonomyRevision: '2', presentationRevision: '3' });
    expect(invocations).toEqual([
      { command: 'nimi.shell.localApp.sharedAgentAIConfigGet', payload: {} },
      { command: 'nimi.shell.localApp.sharedAgentAIConfigOverwrite', payload: { payload: { expectedRevision: '0', capabilities: [] } } },
      { command: 'nimi.shell.localApp.sharedAgentAIConfigLocalOptions', payload: { kind: 'local-loadouts', capabilityContract: 'text.generate', search: '' } },
      { command: 'nimi.shell.localApp.sharedAgentAIConfigLocalOptions', payload: { kind: 'preset-voices', capabilityContract: '', search: '' } },
      { command: 'nimi.shell.localApp.agentManagerSnapshot', payload: { payload: { agentHandle: handle, conversationAnchorId: 'anchor-1' } } },
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
          intent: { defaultVoiceReference: 'preset_voice_id:serena' },
          importedAssets: [],
        } },
      },
    ]);
    expect(JSON.stringify(invocations)).not.toMatch(/sessionId|appId|agentId/u);
  });

  it('physically omits the retired access-workflow namespace', () => {
    const surface = createNimiLocalAppStandardShellSurface() as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual([
      'session', 'ai', 'aiConfig', 'storage', 'realm', 'agents', 'agentConfigure', 'conversation', 'agentRealtime',
    ].sort());
    expect(Object.keys(surface.agentConfigure as Record<string, unknown>).sort()).toEqual([
      'sharedAIConfig', 'manager', 'autonomy', 'presentation', 'memory',
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
      lorebookDeclaration: { identityBaseSetting: 'A test world.', rolePlacements: [], worldRules: [] },
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
        payload: { payload: {
          core: {},
          lorebookDeclaration: { identityBaseSetting: 'A test world.', rolePlacements: [], worldRules: [] },
          origin: { kind: 'manual' },
          visibility: 'private',
        } },
      },
    ]);
    expect(JSON.stringify(invocations)).not.toMatch(/methodId|realmBaseUrl|caller|authorization/u);
  });

  it('projects exact owner PersonaCharacter commands and rejects caller authority fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    const profileInput = {
      profileSchemaVersion: 'realm.character-profile-core/v1',
      identity: { name: 'Persona', summary: 'line one\nline two' },
      presentation: { displayName: 'Persona' },
      narrative: { summary: 'Narrative' },
      interactionProfile: { interactionModes: [] },
      assets: {
        resourceRefs: [], intents: [],
        externalRefs: [{ refId: 'avatar', kind: 'image', uri: 'https://cdn.example/avatar.png?size=large' }],
      },
      authoring: {
        source: 'test',
        extensions: {
          'works.nimi.role-setting': {
            extensionSchemaVersion: 'role-setting/v1', namespace: 'works.nimi.role-setting', productSemantic: true,
            fields: { endpoint: 'story-chapter', route: 'east-road' },
          },
        },
      },
    };
    const lorebookDeclaration = {
      identity: 'Owner PersonaCharacter acceptance',
      behavior: ['Stay practical.'],
      speaking: ['Speak clearly.'],
      immutableBoundaries: ['Do not invent source facts.'],
      relationshipPostures: [],
    };
    const persona = {
      id: 'persona-1', worldId: 'world-1', schemaVersion: 'realm.persona-character-core/v1',
      contentHash: 'a'.repeat(64), contentRevision: 1, sourceHash: 'b'.repeat(64), visibility: 'private',
      origin: { kind: 'manual' },
      lorebookDeclaration,
      profile: {
        ...profileInput,
        profileHash: 'c'.repeat(64),
        profileCoverage: {
          manifestSchemaVersion: 'realm.character-profile-coverage/v1',
          requiredSections: [], optionalSections: [], requiredRefs: [], optionalRefs: [], diagnostics: [],
          aggregateStatus: 'complete', profileCoverageHash: 'd'.repeat(64),
        },
      },
      validity: { status: 'valid', issues: [] }, materializationReadiness: { status: 'ready', blockers: [] },
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    };
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return command.endsWith('ListOwned') ? [persona] : persona;
      },
      listen: () => () => {},
    };
    const owner = createNimiLocalAppStandardShellSurface().realm.personaCharacter;
    await expect(owner.listOwned({ worldId: 'world-1', visibility: 'private', afterId: 'persona-0', take: 50 })).resolves.toEqual([persona]);
    await expect(owner.getOwned('persona-1')).resolves.toEqual(persona);
    await expect(owner.create({ worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration, profile: profileInput })).resolves.toEqual(persona);
    await expect(owner.replace({ personaCharacterId: 'persona-1', baseContentHash: 'a'.repeat(64), worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration, profile: profileInput })).resolves.toEqual(persona);
    expect(() => owner.listOwned({ scope: 'owned' } as never)).toThrow();
    expect(() => owner.create({ worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration, profile: profileInput, ownerAccountId: 'acct-1' } as never)).toThrow();
    await expect(owner.create({ worldId: 'world-1', visibility: 'private', origin: { kind: 'forge' }, lorebookDeclaration, profile: { token: 'product-token' } } as never)).resolves.toEqual(persona);
    expect(JSON.stringify(invocations)).not.toMatch(/ownerAccountId|methodId|realmBaseUrl|authorization/u);

    expect(invocations[0]).toEqual({
      command: 'nimi.shell.localApp.realmPersonaCharacterListOwned',
      payload: { payload: { worldId: 'world-1', visibility: 'private', afterId: 'persona-0', take: 50 } },
    });
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

  it('cancels an in-flight conversation transcription with the same host command', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    let resolveTranscription: ((value: unknown) => void) | undefined;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if ((payload as { payload?: { action?: string } })?.payload?.action === 'cancel') {
          return { canceled: true };
        }
        return new Promise((resolve) => { resolveTranscription = resolve; });
      },
      listen: () => () => {},
    };
    const controller = new AbortController();
    const transcription = createNimiLocalAppStandardShellSurface().conversation.transcribeVoice({
      agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1', requestId: 'voice-request-1',
      mimeType: 'audio/webm', audioBytes: [1, 2, 3],
    }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' });
    resolveTranscription?.({ text: 'late transcript' });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.conversationVoiceTranscribe',
        payload: { payload: {
          agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1', requestId: 'voice-request-1',
          mimeType: 'audio/webm', audioBytes: [1, 2, 3],
        } },
      },
      {
        command: 'nimi.shell.localApp.conversationVoiceTranscribe',
        payload: { payload: { action: 'cancel', requestId: 'voice-request-1' } },
      },
    ]);
  });

  it('renders committed conversation voice with only handle and committed message selectors', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return {
          voice: {
            voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', state: 'ready',
            artifactId: 'artifact-voice-1', reasonCode: null, message: null,
          },
        };
      },
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().conversation.renderVoice({
      agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1',
      messageId: 'message-1', requestId: 'voice-render-request-1',
    })).resolves.toEqual({
      voice: {
        voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', state: 'ready',
        artifactId: 'artifact-voice-1', reasonCode: null, message: null,
      },
    });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.conversationVoiceRender',
      payload: { payload: {
        agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1',
        messageId: 'message-1', requestId: 'voice-render-request-1',
      } },
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
          type: 'message-committed',
          conversationAnchorId: 'anchor-1',
          sequence: '1',
          turnId: 'agent-turn-1',
          message: {
            messageId: 'message-1',
            turnId: 'agent-turn-1',
            role: 'assistant',
            parts: [{ kind: 'text', text: 'hello' }],
          },
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

  it('sends one exact content-part conversation turn and rejects legacy attachment residue', async () => {
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
      parts: [{ kind: 'text', text: 'hello' }],
    })).resolves.toEqual({ turnId: 'agent-turn-1' });
    expect(invocations).toEqual([{
      command: 'nimi.shell.localApp.conversationSendTurn',
      payload: {
        payload: {
          agentHandle: 'lash_owner_issued',
          conversationAnchorId: 'anchor-1',
          requestId: 'request-1',
          parts: [{ kind: 'text', text: 'hello' }],
        },
      },
    }]);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      parts: [{ kind: 'text', text: 'hello' }],
      attachments: [{ artifactId: 'artifact_01J' }],
    } as never)).toThrow(/input fields must be exactly/u);
    expect(() => conversation.send({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      parts: [{ kind: 'text', text: '' }],
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
        if (command.endsWith('assetReveal')) return { revealed: true };
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
    await expect(assets.reveal(unicodePath)).resolves.toEqual({ revealed: true });
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
