import { describe, expect, it } from 'vitest';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

import {
  NimiElectronLocalAppHostError,
  registerNimiElectronRuntimeBridge,
} from '../src/main/index.js';
import { dispatchElectronLocalAppCommand } from '../src/main/local-app-commands.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

describe('Electron local-app standard-shell operations', () => {
  it('maps unavailable Manager owner state to the standard Runtime-unavailable code', async () => {
    const host = {
      agentManagerSnapshot: async () => {
        throw new NimiElectronLocalAppHostError('local-app-owner-unavailable', true);
      },
    } as never;
    await expect(dispatchElectronLocalAppCommand({
      host,
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentManagerSnapshot'],
      payload: { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    })).rejects.toMatchObject({
      code: 'runtime-service-unavailable',
      reasonCode: 'local-app-owner-unavailable',
    });
  });

  it('projects the Runtime asset path and list bounds without narrowing Unicode paths', async () => {
    const calls: unknown[] = [];
    const host = {
      assetStat: async (input: unknown) => { calls.push(['stat', input]); return {}; },
      assetList: async (input: unknown) => { calls.push(['list', input]); return {}; },
    } as never;
    const unicodePath = '媒体/é.wav';
    const maximumPath = `${'a'.repeat(255)}/${'b'.repeat(255)}/${'c'.repeat(255)}/${'d'.repeat(254)}/e`;
    await dispatchElectronLocalAppCommand({
      host, command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'], payload: { relativePath: unicodePath },
    });
    await dispatchElectronLocalAppCommand({
      host, command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'], payload: { relativePath: maximumPath },
    });
    await dispatchElectronLocalAppCommand({
      host, command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetList'],
      payload: { prefix: '媒体/', cursor: '', pageSize: 500 },
    });
    expect(calls).toEqual([
      ['stat', { relativePath: unicodePath }],
      ['stat', { relativePath: maximumPath }],
      ['list', { prefix: '媒体/', cursor: '', pageSize: 500 }],
    ]);
    await expect(dispatchElectronLocalAppCommand({
      host, command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'], payload: { relativePath: '媒体/e\u0301.wav' },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    await expect(dispatchElectronLocalAppCommand({
      host, command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetList'],
      payload: { prefix: '媒体/', cursor: '', pageSize: 501 },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  });

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

  it('routes a closed scenario execute payload without route selection', async () => {
    const calls: unknown[] = [];
    const command = 'nimi.shell.localApp.scenarioExecute';
    const host = localAppHost(calls);
    await expect(dispatchElectronLocalAppCommand({
      host,
      command,
      payload: { spec: { type: 'text-embed', inputs: ['hello'] } },
    })).resolves.toEqual({ output: { type: 'text-embed', vectors: [[0.1]] }, traceId: 'trace-1' });
    expect(calls).toEqual([['scenarioExecute', { spec: { type: 'text-embed', inputs: ['hello'] } }]]);

    await expect(dispatchElectronLocalAppCommand({
      host,
      command,
      payload: { spec: { type: 'text-embed', inputs: ['hello'], modelId: 'forbidden' } },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  });

  it('preserves optional parameter presence and applies owner clamps', async () => {
    const calls: unknown[] = [];
    const host = localAppHost(calls);
    await dispatchElectronLocalAppCommand({
      host,
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'],
      payload: {
        messages: [{ role: 'user', text: 'hello' }],
        temperature: 0, topP: 0, maxTokens: 0, topK: 0,
        presencePenalty: -2, frequencyPenalty: 2, stop: ['END'], seed: 0,
      },
    });
    await dispatchElectronLocalAppCommand({
      host,
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioExecute'],
      payload: { spec: {
        type: 'image-generate', prompt: 'portrait', negativePrompt: '', n: 0,
        size: '', aspectRatio: '', quality: '', style: '', seed: 0,
        referenceImages: ['https://example.com/reference.png'],
        referenceImageArtifactId: '',
        mask: 'https://example.com/mask.png', responseFormat: 'b64_json',
      } },
    });
    await dispatchElectronLocalAppCommand({
      host,
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
      payload: { spec: {
        type: 'speech-synthesize', text: 'hello', language: '', audioFormat: '',
        sampleRateHz: 0, speed: 4, pitch: -24, volume: 4, emotion: '',
        voiceRef: null, timingMode: 'none', voiceRenderHints: null,
      }, timeoutMs: 0 },
    });
    expect(calls[0]).toEqual(['textGenerateCandidate', {
      messages: [{ role: 'user', text: 'hello' }],
      temperature: 0, topP: 0, maxTokens: 0, topK: 0,
      presencePenalty: -2, frequencyPenalty: 2, stop: ['END'], seed: 0,
    }]);
    expect(calls[1]).toEqual(['scenarioExecute', expect.objectContaining({ spec: expect.objectContaining({ n: 0, seed: 0 }) })]);
    expect(calls[2]).toEqual(['scenarioJobSubmit', expect.objectContaining({ spec: expect.objectContaining({ pitch: -24 }) })]);

    await expect(dispatchElectronLocalAppCommand({
      host,
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
      payload: { spec: {
        type: 'speech-synthesize', text: 'hello', language: '', audioFormat: '',
        pitch: -24.1, emotion: '', voiceRef: null, timingMode: 'none', voiceRenderHints: null,
      }, timeoutMs: 0 },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  });

  it('preserves the route-neutral safe integer image seed carrier', async () => {
    const calls: unknown[] = [];
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'];
    const spec = {
      type: 'image-generate', prompt: 'portrait', negativePrompt: '',
      size: '', aspectRatio: '', quality: '', style: '',
      referenceImages: [], referenceImageArtifactId: '', mask: '', responseFormat: '',
    };
    for (const seed of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
      await expect(dispatchElectronLocalAppCommand({
        host: localAppHost(calls), command, payload: { spec: { ...spec, seed }, timeoutMs: 0 },
      })).resolves.toEqual({ job: null, asset: null });
    }
    expect(calls).toEqual([
      ['scenarioJobSubmit', { spec: { ...spec, seed: Number.MIN_SAFE_INTEGER }, timeoutMs: 0 }],
      ['scenarioJobSubmit', { spec: { ...spec, seed: Number.MAX_SAFE_INTEGER }, timeoutMs: 0 }],
    ]);
    for (const seed of [Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(dispatchElectronLocalAppCommand({
        host: localAppHost(calls), command, payload: { spec: { ...spec, seed }, timeoutMs: 0 },
      })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    }
    expect(calls).toHaveLength(2);
  });

  it('admits one bounded artifact-owned image reference and rejects mixed carriers', async () => {
    const calls: unknown[] = [];
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'];
    const spec = {
      type: 'image-generate', prompt: 'edit the portrait', negativePrompt: '',
      size: '', aspectRatio: '', quality: '', style: '',
      referenceImages: [], referenceImageArtifactId: 'artifact-image-source-1',
      mask: '', responseFormat: '',
    };

    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: { spec, timeoutMs: 0 },
    })).resolves.toEqual({ job: null, asset: null });
    expect(calls).toEqual([['scenarioJobSubmit', { spec, timeoutMs: 0 }]]);

    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: {
        spec: { ...spec, referenceImages: ['https://example.com/reference.png'] },
        timeoutMs: 0,
      },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: {
        spec: { ...spec, referenceImageArtifactId: ' artifact-image-source-1' },
        timeoutMs: 0,
      },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: {
        spec: { ...spec, referenceImageArtifactId: 'artifact\u007fimage-source-1' },
        timeoutMs: 0,
      },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    expect(calls).toHaveLength(1);
  });

  it('admits only the canonical video seed range', async () => {
    const calls: unknown[] = [];
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'];
    const spec = {
      type: 'video-generate', prompt: 'draw a moon', negativePrompt: '', mode: 't2v', content: [],
      options: { resolution: '720p', ratio: '16:9', seed: -1 },
    };

    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: { spec, timeoutMs: 0 },
    })).resolves.toEqual({ job: null, asset: null });
    expect(calls).toEqual([['scenarioJobSubmit', { spec, timeoutMs: 0 }]]);
    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command,
      payload: { spec: { ...spec, options: { ...spec.options, seed: 4_294_967_296 } }, timeoutMs: 0 },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  });

  it('keeps the exact Runtime voice reason through the standard-shell envelope', async () => {
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
          scenarioJobSubmit: async () => {
            throw new NimiElectronLocalAppHostError('ai-voice-target-model-mismatch', false);
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
      payload: { payload: { spec: {
        type: 'speech-synthesize', text: 'hello', language: '', audioFormat: '', emotion: '',
        voiceRef: { type: 'voice-asset', id: 'voice-asset-1' },
        timingMode: 'none', voiceRenderHints: null,
      }, timeoutMs: 0 } },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'ai-voice-target-model-mismatch',
      details: { retryable: false },
    });
  });

  it('admits only canonical voice-create sources and rejects legacy voice identities', async () => {
    const calls: unknown[] = [];
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'];
    const referenceAudio = {
      type: 'voice-create', creationSource: 'reference-audio',
      referenceAudio: { type: 'bytes', bytes: [1, 2] }, referenceAudioMime: 'audio/wav',
      languageHints: ['en'], preferredName: 'Reference Voice', text: '',
    };
    const textDescription = {
      type: 'voice-create', creationSource: 'text-description',
      instructionText: 'A calm, warm voice.', previewText: 'Hello.',
      language: 'en', preferredName: 'Designed Voice',
    };

    for (const spec of [referenceAudio, textDescription]) {
      await expect(dispatchElectronLocalAppCommand({
        host: localAppHost(calls), command, payload: { spec, timeoutMs: 0 },
      })).resolves.toEqual({ job: null, asset: null });
    }
    expect(calls).toEqual([
      ['scenarioJobSubmit', { spec: referenceAudio, timeoutMs: 0 }],
      ['scenarioJobSubmit', { spec: textDescription, timeoutMs: 0 }],
    ]);

    for (const spec of [
      { ...referenceAudio, type: 'voice-clone' },
      { ...textDescription, type: 'voice-design' },
      { ...referenceAudio, creationSource: 'text-description' },
    ]) {
      await expect(dispatchElectronLocalAppCommand({
        host: localAppHost(calls), command, payload: { spec, timeoutMs: 0 },
      })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    }
    expect(calls).toHaveLength(2);
  });

  it('admits the exact typed inline transcription audio cap before generic JSON bounds', { timeout: 20_000 }, async () => {
    const calls: unknown[] = [];
    const maximum = 32 * 1024 * 1024;
    const bytes = Array.from({ length: maximum + 1 }, () => 0);
    bytes.pop();
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'];
    const spec = {
      type: 'speech-transcribe',
      mimeType: 'audio/wav',
      language: '',
      prompt: '',
      audioSource: { type: 'bytes', bytes },
      responseFormat: '',
    };
    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls),
      command,
      payload: { spec, timeoutMs: 0 },
    })).resolves.toEqual({ job: null, asset: null });
    expect(calls).toHaveLength(1);
    expect((calls[0] as [string, { spec: typeof spec }])[1].spec.audioSource.bytes).toBe(bytes);

    bytes.push(0);
    await expect(dispatchElectronLocalAppCommand({
      host: localAppHost(calls), command, payload: { spec, timeoutMs: 0 },
    })).rejects.toMatchObject({
      reasonCode: 'invalid-payload',
      message: expect.stringContaining('inline bytes are invalid'),
    });
    expect(calls).toHaveLength(1);
  });

  it('routes bounded image artifact upload and rejects MIME or authority expansion', async () => {
    const calls: unknown[] = [];
    const host = localAppHost(calls);
    const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactUpload'];
    await expect(dispatchElectronLocalAppCommand({
      host, command, payload: { bytes: [1, 2], mimeType: 'image/png' },
    })).resolves.toEqual({ artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' });
    expect(calls).toEqual([['artifactUpload', { bytes: [1, 2], mimeType: 'image/png' }]]);
    await expect(dispatchElectronLocalAppCommand({
      host, command, payload: { bytes: [1], mimeType: 'video/mp4' },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    await expect(dispatchElectronLocalAppCommand({
      host, command, payload: { bytes: [1], mimeType: 'image/png', appId: 'forged' },
    })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
  });

  it('admits AIC commands through the registered local-app capability set', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioExecute'],
      payload: { payload: { spec: { type: 'text-embed', inputs: ['hello'] } } },
    })).resolves.toEqual({ output: { type: 'text-embed', vectors: [[0.1]] }, traceId: 'trace-1' });
    expect(calls).toEqual([['scenarioExecute', { spec: { type: 'text-embed', inputs: ['hello'] } }]]);
  });

  it('routes read-only App AIConfig without accepting renderer input', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet'],
      payload: { payload: {} },
    })).resolves.toMatchObject({ config: { capabilities: [] }, revision: '0' });
    expect(calls).toEqual([['aiConfigGet']]);
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
      payload: { payload: {
        core: {},
        lorebookDeclaration: { identityBaseSetting: 'A test world.', rolePlacements: [], worldRules: [] },
        origin: { kind: 'manual' },
        visibility: 'private',
      } },
    })).resolves.toEqual({ id: 'world-2' });
    expect(calls).toEqual([
      ['realmWorldCoreList', { take: 20, visibility: 'private' }],
      ['realmWorldCoreCreate', {
        core: {},
        lorebookDeclaration: { identityBaseSetting: 'A test world.', rolePlacements: [], worldRules: [] },
        origin: { kind: 'manual' },
        visibility: 'private',
      }],
    ]);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList'],
      payload: { payload: { methodId: 'WorldCoreController_listWorldCores' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
  });

  it('routes only the five exact owner PersonaCharacter operations', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    const lorebookDeclaration = {
      identity: 'Owner PersonaCharacter acceptance',
      behavior: ['Stay practical.'],
      speaking: ['Speak clearly.'],
      immutableBoundaries: ['Do not invent source facts.'],
      relationshipPostures: [],
    };
    const create = {
      worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration, profile: {},
    };
    const replace = { personaCharacterId: 'persona-1', baseContentHash: 'a'.repeat(64), ...create };
    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterListOwned'],
      payload: { payload: { worldId: 'world-1', visibility: 'private', afterId: 'persona-0', take: 50 } },
    });
    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterGetOwned'],
      payload: { payload: { personaCharacterId: 'persona-1' } },
    });
    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterCreate'],
      payload: { payload: create },
    });
    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterReplace'],
      payload: { payload: replace },
    });
    await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterDelete'],
      payload: { payload: { personaCharacterId: 'persona-1' } },
    });
    expect(calls).toEqual([
      ['realmPersonaCharacterListOwned', { worldId: 'world-1', visibility: 'private', afterId: 'persona-0', take: 50 }],
      ['realmPersonaCharacterGetOwned', { personaCharacterId: 'persona-1' }],
      ['realmPersonaCharacterCreate', create],
      ['realmPersonaCharacterReplace', {
        personaCharacterId: 'persona-1',
        body: {
          baseContentHash: 'a'.repeat(64), worldId: 'world-1', visibility: 'private',
          origin: { kind: 'manual' }, lorebookDeclaration, profile: {},
        },
      }],
      ['realmPersonaCharacterDelete', { personaCharacterId: 'persona-1' }],
    ]);
    for (const forbidden of [
      { scope: 'owned' },
      { methodId: 'WorldCoreController_listPersonaCharacters' },
      { token: 'secret' },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterListOwned'],
        payload: { payload: forbidden },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
    }
  });

  it('routes the bounded authoritative Realm Chat list operation', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    registerBridge(ipcMain, calls);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmChatList'],
      payload: { payload: { cursor: 'chat-0', limit: 20 } },
    })).resolves.toEqual({ items: [], nextCursor: null });
    expect(calls).toEqual([['realmChatList', { cursor: 'chat-0', limit: 20 }]]);
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmChatList'],
      payload: { payload: { limit: 51 } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
  });

  it('keeps PersonaCharacter canonical reason and standard-shell code identical', async () => {
    for (const reasonCode of [
      'capability-unavailable', 'invalid-input', 'session-invalid', 'access-denied',
      'owner-authority-missing', 'not-found', 'content-conflict', 'realm-unavailable',
      'rate-limited', 'upstream-failed', 'contract-invalid', 'request-too-large', 'response-too-large',
    ]) {
      const host = {
        realmPersonaCharacterGetOwned: async () => {
          throw new NimiElectronLocalAppHostError(reasonCode, false);
        },
      } as never;
      await expect(dispatchElectronLocalAppCommand({
        host,
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterGetOwned'],
        payload: { personaCharacterId: 'persona-1' },
      })).rejects.toMatchObject({ code: reasonCode, reasonCode });
    }
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

  it('reaches all nine conversation operations and the transcription cancel action but preserves typed failures', async () => {
    const requests = [
      ['local-app.conversationOpen', { agentHandle: 'lash_one' }],
      ['local-app.conversationSendTurn', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'request-1', parts: [{ kind: 'text', text: 'hello' }] }],
      ['local-app.conversationAttachmentUpload', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', mimeType: 'image/png', bytes: [1] }],
      ['local-app.conversationArtifactRead', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', artifactId: 'artifact-1' }],
      ['local-app.conversationVoiceTranscribe', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'voice-request-1', mimeType: 'audio/webm', audioBytes: [1] }],
      ['local-app.conversationVoiceTranscribe', { action: 'cancel', requestId: 'voice-request-1' }],
      ['local-app.conversationVoiceRender', { agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', messageId: 'message-1', requestId: 'voice-render-request-1' }],
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

  it('routes the canonical Agent configuration operations through the protected host', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    registerBridge(ipcMain, calls);
    const requests = [
      ['local-app.sharedAgentAIConfigGet', {}],
      ['local-app.sharedAgentAIConfigOverwrite', { expectedRevision: '0', capabilities: [] }],
      ['local-app.sharedAgentAIConfigLocalOptions', { kind: 'local-loadouts', capabilityContract: 'text.generate', search: '' }],
      ['local-app.sharedAgentAIConfigLocalOptions', { kind: 'preset-voices', capabilityContract: '', search: '' }],
      ['local-app.sharedAgentAIConfigLocalOptions', { kind: 'voice-assets', capabilityContract: '', search: '' }],
      ['local-app.agentManagerSnapshot', { agentHandle: handle, conversationAnchorId: 'anchor-1' }],
      ['local-app.agentAutonomySnapshot', { agentHandle: handle }],
      ['local-app.agentUpdateAutonomy', {
        agentHandle: handle, expectedAutonomyRevision: '2', intent: { enabled: true },
      }],
      ['local-app.agentPresentationSnapshot', { agentHandle: handle }],
      ['local-app.agentCommitPresentation', {
        agentHandle: handle,
        expectedPresentationRevision: '0',
        intent: { defaultVoiceReference: 'preset_voice_id:serena' },
        importedAssets: [],
      }],
      ['local-app.agentMemoryInspect', { agentHandle: handle, limit: 2, pageToken: 'opaque-page-2' }],
      ['local-app.agentMemoryCorrect', { agentHandle: handle, memoryId: 'memory-1', correctedContent: 'corrected' }],
      ['local-app.agentMemoryForget', { agentHandle: handle, memoryIds: ['memory-1'], confirmed: true }],
      ['local-app.agentMemorySwitch', { agentHandle: handle, enabled: false }],
      ['local-app.agentMemoryDelete', { agentHandle: handle, confirmed: true }],
    ] as const;
    for (const [operation, payload] of requests) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS[operation],
        payload: { payload },
      })).resolves.toBeDefined();
    }
    expect(calls).toEqual([
      ['sharedAgentAIConfigGet'],
      ['sharedAgentAIConfigOverwrite', { expectedRevision: '0', capabilities: [] }],
      ['sharedAgentAIConfigLocalOptions', { kind: 'local-loadouts', capabilityContract: 'text.generate', search: '' }],
      ['sharedAgentAIConfigLocalOptions', { kind: 'preset-voices', capabilityContract: '', search: '' }],
      ['sharedAgentAIConfigLocalOptions', { kind: 'voice-assets', capabilityContract: '', search: '' }],
      ['agentManagerSnapshot', { agentHandle: handle, conversationAnchorId: 'anchor-1' }],
      ['agentAutonomySnapshot', { agentHandle: handle }],
      ['agentUpdateAutonomy', {
        agentHandle: handle, expectedAutonomyRevision: '2', intent: { enabled: true },
      }],
      ['agentPresentationSnapshot', { agentHandle: handle }],
      ['agentCommitPresentation', requests[9][1]],
      ['agentMemoryInspect', { agentHandle: handle, limit: 2, pageToken: 'opaque-page-2' }],
      ['agentMemoryCorrect', { agentHandle: handle, memoryId: 'memory-1', correctedContent: 'corrected' }],
      ['agentMemoryForget', { agentHandle: handle, memoryIds: ['memory-1'], confirmed: true }],
      ['agentMemorySwitch', { agentHandle: handle, enabled: false }],
      ['agentMemoryDelete', { agentHandle: handle, confirmed: true }],
    ]);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'],
      payload: { payload: { agentHandle: handle } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toHaveLength(15);

    for (const payload of [
      { kind: 'preset-voices', capabilityContract: 'audio.synthesize', search: '' },
      { kind: 'preset-voices', capabilityContract: '', search: 'serena' },
      { kind: 'preset-voices', capabilityContract: '', connectorRef: 'forbidden', search: '' },
      { kind: 'voice-assets', capabilityContract: 'audio.synthesize', search: '' },
      { kind: 'voice-assets', capabilityContract: '', search: 'voice' },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigLocalOptions'],
        payload: { payload },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
    }
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigLocalOptions'],
      payload: { payload: { kind: 'preset-voices', capabilityContract: '', search: '' } },
    })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(calls).toHaveLength(15);
  });

  it('defaults and bounds opaque Memory pagination selectors before protected carriage', async () => {
    const ipcMain = new FakeIpcMain();
    const calls: unknown[] = [];
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    registerBridge(ipcMain, calls);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryInspect'],
      payload: { payload: { agentHandle: handle } },
    })).resolves.toBeDefined();
    expect(calls).toEqual([['agentMemoryInspect', {
      agentHandle: handle,
      limit: 100,
      pageToken: '',
    }]]);

    for (const payload of [
      { agentHandle: handle, limit: 0, pageToken: '' },
      { agentHandle: handle, limit: 101, pageToken: '' },
      { agentHandle: handle, limit: 1, pageToken: ' bad ' },
      { agentHandle: handle, limit: 1, pageToken: 'x'.repeat(1025) },
      { agentHandle: handle, limit: 1, pageToken: '', ownerUserId: 'forbidden' },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryInspect'],
        payload: { payload },
      })).rejects.toMatchObject({ code: 'invalid-payload' });
    }
    expect(calls).toHaveLength(1);
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
          parts: [{ kind: 'text', text: 'hello' }],
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
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.assetReveal'],
      payload: { payload: { relativePath: 'media/music/run.wav' } },
    })).resolves.toEqual({ revealed: true });
    expect(calls).toContainEqual(['assetReveal', { relativePath: 'media/music/run.wav' }]);

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
      payload: { payload: { relativePath: '../escape.json' } },
    })).rejects.toMatchObject({ code: 'invalid-payload', reasonCode: 'invalid-payload' });
  });

  it('hard-rejects legacy conversation attachment residue before the carrier', async () => {
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
          parts: [{ kind: 'text', text: 'hello' }],
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
          parts: [{ kind: 'text', text: '' }],
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

function managerActionAvailability() {
  return {
    getSharedAIConfig: { state: 'available', reason: null },
    overwriteSharedAIConfig: { state: 'available', reason: null },
    readAutonomy: { state: 'available', reason: null },
    updateAutonomy: { state: 'available', reason: null },
    inspectMemory: { state: 'available', reason: null },
    correctMemory: { state: 'unavailable', reason: 'memory-disabled' },
    forgetMemory: { state: 'available', reason: null },
    switchMemory: { state: 'available', reason: null },
    deleteAllMemory: { state: 'available', reason: null },
    replaceAppearance: { state: 'available', reason: null },
    restorePreviousAppearance: {
      state: 'unavailable', reason: 'previous-presentation-unavailable',
    },
  };
}

function localAppHost(calls: unknown[]) {
  return {
    sessionStatus: async () => ({ state: 'ready', reasonCode: 'action-executed', retryable: false }),
    aiConfigGet: async () => {
      calls.push(['aiConfigGet']);
      return {
        config: { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] },
        revision: '0', effectiveSelections: [],
      };
    },
    aiConfigOverwrite: async (input: unknown) => { calls.push(['aiConfigOverwrite', input]); return {}; },
    aiConfigLocalOptions: async (input: unknown) => { calls.push(['aiConfigLocalOptions', input]); return {}; },
    textGenerateCandidate: async (input: unknown) => {
      calls.push(['textGenerateCandidate', input]);
      return { text: 'hello', finishReason: 'stop', traceId: 'trace-1' };
    },
    textTurnSubscribe: async () => ({ streamId: 'text-turn-1' }),
    textTurnStreamNext: async () => ({ completed: true }),
    textTurnStreamClose: async () => ({ closed: true }),
    scenarioExecute: async (input: unknown) => {
      calls.push(['scenarioExecute', input]);
      return { output: { type: 'text-embed', vectors: [[0.1]] }, traceId: 'trace-1' };
    },
    scenarioJobSubmit: async (input: unknown) => {
      calls.push(['scenarioJobSubmit', input]);
      return { job: null, asset: null };
    },
    scenarioJobGet: async () => ({ job: {} }),
    scenarioJobSubscribe: async () => ({ streamId: 'scenario-job-1' }),
    scenarioJobStreamNext: async () => ({ completed: true }),
    scenarioJobStreamClose: async () => ({ closed: true }),
    scenarioJobCancel: async () => ({ job: {} }),
    artifactRead: async () => ({ bytes: [1], mimeType: 'image/png', sizeBytes: 1 }),
    artifactUpload: async (input: unknown) => {
      calls.push(['artifactUpload', input]);
      return { artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' };
    },
    voiceAssetsList: async () => ({ assets: [], nextPageToken: '' }),
    realmWorldCoreList: async (input: unknown) => {
      calls.push(['realmWorldCoreList', input]);
      return [{ id: 'world-1' }];
    },
    realmWorldCoreCreate: async (input: unknown) => {
      calls.push(['realmWorldCoreCreate', input]);
      return { id: 'world-2' };
    },
    realmPersonaCharacterListOwned: async (input: unknown) => {
      calls.push(['realmPersonaCharacterListOwned', input]);
      return [];
    },
    realmPersonaCharacterGetOwned: async (input: unknown) => {
      calls.push(['realmPersonaCharacterGetOwned', input]);
      return {};
    },
    realmPersonaCharacterCreate: async (input: unknown) => {
      calls.push(['realmPersonaCharacterCreate', input]);
      return {};
    },
    realmPersonaCharacterReplace: async (input: unknown) => {
      calls.push(['realmPersonaCharacterReplace', input]);
      return {};
    },
    realmPersonaCharacterDelete: async (input: unknown) => {
      calls.push(['realmPersonaCharacterDelete', input]);
      return { personaCharacterId: 'persona-1', deleted: true };
    },
    realmChatList: async (input: unknown) => {
      calls.push(['realmChatList', input]);
      return { items: [], nextCursor: null };
    },
    storageReadJson: async (input: unknown) => { calls.push(['storageReadJson', input]); return { value: { version: 1 }, sizeBytes: 13 }; },
    storageWriteJson: async (input: unknown) => { calls.push(['storageWriteJson', input]); return { value: { version: 2 }, sizeBytes: 13 }; },
    storageRemoveJson: async (input: unknown) => { calls.push(['storageRemoveJson', input]); return { removed: true }; },
    assetReveal: async (input: unknown) => { calls.push(['assetReveal', input]); return { revealed: true }; },
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
        config: { owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } }, capabilities: [] },
        revision: '0', effectiveSelections: [],
      };
    },
    sharedAgentAIConfigOverwrite: async (input: unknown) => {
      calls.push(['sharedAgentAIConfigOverwrite', input]);
      return {
        outcome: 'committed',
        config: { owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } }, capabilities: [] },
        revision: '1', effectiveSelections: [], reasonCode: 'REASON_CODE_UNSPECIFIED',
      };
    },
    sharedAgentAIConfigLocalOptions: async (input: unknown) => {
      calls.push(['sharedAgentAIConfigLocalOptions', input]);
      return { kind: 'local-loadouts', options: [], truncated: false };
    },
    agentManagerSnapshot: async (input: unknown) => {
      calls.push(['agentManagerSnapshot', input]);
      return {
        lifecycleStatus: 'active', executionState: 'idle', statusText: '', currentEmotion: '',
        source: null, context: null, actionAvailability: managerActionAvailability(),
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
      return { profile: null, previousProfile: null, defaultVoiceReference: '', avatarAutoplay: false, presentationRevision: '0' };
    },
    agentCommitPresentation: async (input: unknown) => {
      calls.push(['agentCommitPresentation', input]);
      return { profile: null, previousProfile: null, defaultVoiceReference: '', avatarAutoplay: false, presentationRevision: '1' };
    },
    agentMemoryInspect: async (input: unknown) => {
      calls.push(['agentMemoryInspect', input]);
      return {
        outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
        currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
      };
    },
    agentMemoryCorrect: async (input: unknown) => {
      calls.push(['agentMemoryCorrect', input]);
      return { outcome: 'committed', affectedMemoryIds: [], projection: null };
    },
    agentMemoryForget: async (input: unknown) => {
      calls.push(['agentMemoryForget', input]);
      return { outcome: 'forgotten', affectedMemoryIds: [], projection: null };
    },
    agentMemorySwitch: async (input: unknown) => {
      calls.push(['agentMemorySwitch', input]);
      return { outcome: 'committed', affectedMemoryIds: [], projection: null };
    },
    agentMemoryDelete: async (input: unknown) => {
      calls.push(['agentMemoryDelete', input]);
      return { outcome: 'deleted', affectedMemoryIds: [], projection: null };
    },
    conversationOpen: unavailable('conversationOpen', calls),
    conversationSendTurn: unavailable('conversationSendTurn', calls),
    conversationAttachmentUpload: unavailable('conversationAttachmentUpload', calls),
    conversationArtifactRead: unavailable('conversationArtifactRead', calls),
    conversationVoiceTranscribe: unavailable('conversationVoiceTranscribe', calls),
    conversationVoiceRender: unavailable('conversationVoiceRender', calls),
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
