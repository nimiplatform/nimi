import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_EXECUTION_MODE_STREAM,
  RUNTIME_EXECUTION_MODE_SYNC,
  RUNTIME_ROUTE_POLICY_CLOUD,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_REASON_CODE_AI_MODEL_NOT_FOUND,
  RUNTIME_SCENARIO_TYPE_TEXT_EMBED,
  RUNTIME_SCENARIO_TYPE_TEXT_GENERATE,
  RUNTIME_SCHEDULING_DENIED,
  cleanupBehaviorModules,
  createMemoryStorage,
  importBehaviorModule,
  installStandardShellAIConfigHarness,
  listSourceFiles,
  read,
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
  root,
  runnableSchedulingResponse,
  textEmbedScenarioResponse,
  textGenerateScenarioResponse,
  textScenarioStream,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);
test.beforeEach((t) => {
  installStandardShellAIConfigHarness(t);
});

test('tester runtime media invokers use AIConfig bindings instead of executable auto routing', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const imageVideoInvokers = read('src/tester/tester-runtime-invokers-media-image-video.ts');
  const speechInvokers = read('src/tester/tester-runtime-invokers-media-speech.ts');
  assert.doesNotMatch(invokers, /model:\s*['"]auto['"]/);
  assert.match(invokers, /resolveTesterLLMBinding/);
  assert.match(invokers, /runRuntimeAIConsumeCapability/);
  for (const capability of [
    'image.generate',
    'video.generate',
    'audio.synthesize',
    'audio.transcribe',
    'speech.bundle',
  ]) {
    assert.doesNotMatch(imageVideoInvokers, new RegExp(`resolveTesterLLMBinding\\('${capability}'\\)`));
    assert.doesNotMatch(speechInvokers, new RegExp(`resolveTesterLLMBinding\\('${capability}'\\)`));
  }
  assert.doesNotMatch(imageVideoInvokers, /ensureSchedulingPreflight/);
  assert.doesNotMatch(speechInvokers, /ensureSchedulingPreflight/);
  assert.doesNotMatch(imageVideoInvokers, /schedulingTarget:\s*null/);
  assert.doesNotMatch(speechInvokers, /schedulingTarget:\s*null/);
});

test('tester voice catalog invoker consumes Kit generation voice catalog consumer', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.match(invokers, /runRuntimeVoiceCatalog/);
  assert.match(invokers, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.doesNotMatch(invokers, /ListPresetVoicesRequest/);
  assert.doesNotMatch(invokers, /ListPresetVoicesResponse/);
  assert.doesNotMatch(invokers, /from '@nimiplatform\/sdk\/runtime\/wire-types'/);
  assert.doesNotMatch(invokers, /client\.runtime\.ai\.listPresetVoices/);
  assert.doesNotMatch(invokers, /Runtime AI voice catalog facade is not exposed by vNext/);
  assert.doesNotMatch(invokers, /readonly listPresetVoices\?: \(request: \{\s*readonly appId: string;/);
});

test('tester local TTS voice resolution has no active VoiceAsset fallback surface', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.doesNotMatch(invokers, /ListVoiceAssetsRequest/);
  assert.doesNotMatch(invokers, /ListVoiceAssetsResponse/);
  assert.doesNotMatch(invokers, /\blistVoiceAssets\b/);
  assert.equal(existsSync(path.join(root, 'src/tester/tester-runtime-media-bindings.ts')), false);
});

test('tester chat.stream consumes Kit chat runtime provider (no fabricated text)', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const runtime = read('src/tester/tester-runtime.ts');
  const capabilities = readTesterAiTestingSurface(root);

  // The live-delta callback is threaded from the Kit simple-ai provider, through
  // runTesterCapability, into the capability panel. Tester is the second app
  // consumer of the reusable Kit chat runtime primitive; SDK remains the
  // provider's lower-level stream assembly surface.
  assert.match(invokers, /onPartial\?: \(accumulatedText: string\) => void/);
  assert.match(invokers, /from '@nimiplatform\/kit\/features\/chat\/runtime'/);
  assert.match(invokers, /createSimpleAiConversationProvider/);
  assert.match(invokers, /createSdkConversationRuntimeAdapter/);
  assert.match(invokers, /resolveRuntimeUserMessage: \(\) => buildChatRuntimeUserMessage\(prompt\)/);
  assert.match(invokers, /for await \(const event of provider\.runTurn/);
  assert.match(invokers, /event\.type === 'text-delta'/);
  assert.match(invokers, /streamedText \+= event\.textDelta/);
  assert.match(invokers, /input\.onPartial\?\.\(streamedText\)/);
  assert.doesNotMatch(invokers, /streamAppAiTextResponse/);
  assert.doesNotMatch(invokers, /runAppAiTextTurn/);
  assert.match(runtime, /onPartial: input\.onPartial/);
  assert.match(capabilities, /onPartial: isStreaming \? setStreamingText : undefined/);
  assert.match(capabilities, /capability\.id === 'chat\.stream'/);
  assert.match(capabilities, /streamingText=\{streamingText\}/);
});

test('tester text.generate and text.embed consume Kit generation runtime consumers', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.match(invokers, /runRuntimeAIConsumeCapability/);
  assert.match(invokers, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.match(invokers, /NimiRuntimeAIScenarioClient/);
  assert.match(invokers, /runtime: client\.runtime/);
  assert.doesNotMatch(invokers, /runNimiTextGenerate/);
  assert.doesNotMatch(invokers, /createNimiRuntimeAIModel/);
  assert.doesNotMatch(invokers, /createNimiRuntimeEmbeddingClient/);
  assert.doesNotMatch(invokers, /@nimiplatform\/sdk\/ai-app/);
  assert.doesNotMatch(invokers, /runtime\.ai\.text\.generate/);
});

test('tester video.generate and audio.transcribe consume Kit generation runtime consumers', () => {
  const imageVideoInvokers = read('src/tester/tester-runtime-invokers-media-image-video.ts');
  const speechInvokers = read('src/tester/tester-runtime-invokers-media-speech.ts');
  const mediaRuntime = read('src/tester/tester-runtime-invokers-media-runtime.ts');
  const kitGenerationRuntime = read('../../kit/features/generation/src/runtime.ts');
  assert.match(imageVideoInvokers, /runRuntimeVideoGenerate/);
  assert.match(speechInvokers, /runRuntimeSpeechTranscribe/);
  assert.match(imageVideoInvokers, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.match(speechInvokers, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.match(mediaRuntime, /buildRuntimeGenerationScenarioIdentity/);
  assert.match(kitGenerationRuntime, /runtime-identity/);
  assert.doesNotMatch(imageVideoInvokers, /buildNimiRuntimeGenerationSubmitRequest/);
  assert.doesNotMatch(imageVideoInvokers, /runNimiRuntimeScenarioJob/);
  assert.doesNotMatch(speechInvokers, /runNimiRuntimeSpeechTranscription/);
  assert.doesNotMatch(mediaRuntime, /@nimiplatform\/sdk\/features\/generation/);
  assert.equal(existsSync(path.join(root, 'src/tester/tester-runtime-invokers-media-params.ts')), false);
});

test('tester runtime metadata leaves Electron host-owned identity to the Electron host', async () => {
  const invokerCore = await importBehaviorModule('tester/tester-runtime-invokers-core.js');
  const originalWindow = globalThis.window;
  const originalElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  try {
    globalThis.window = {
      __NIMI_ELECTRON_TEST__: { invoke: async () => ({}) },
    };
    globalThis.__NIMI_ELECTRON_TEST__ = { invoke: async () => ({}) };
    const metadata = invokerCore.buildMetadata('nimi.tester.ai.text.generate', {
      callerKind: 'renderer-should-not-send',
      callerId: 'renderer-should-not-send',
      participantId: 'renderer-should-not-send',
      appId: 'renderer-should-not-send',
      'x-nimi-caller-kind': 'renderer-should-not-send',
      'x-nimi-caller-id': 'renderer-should-not-send',
      aiConfigProfileId: 'behavior-profile',
    });

    assert.equal(metadata.surfaceId, 'nimi.tester.ai.text.generate');
    assert.equal(metadata.aiConfigProfileId, 'behavior-profile');
    assert.equal(Object.hasOwn(metadata, 'callerKind'), false);
    assert.equal(Object.hasOwn(metadata, 'callerId'), false);
    assert.equal(Object.hasOwn(metadata, 'participantId'), false);
    assert.equal(Object.hasOwn(metadata, 'appId'), false);
    assert.equal(Object.hasOwn(metadata, 'x-nimi-caller-kind'), false);
    assert.equal(Object.hasOwn(metadata, 'x-nimi-caller-id'), false);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalElectronTest === undefined) {
      delete globalThis.__NIMI_ELECTRON_TEST__;
    } else {
      globalThis.__NIMI_ELECTRON_TEST__ = originalElectronTest;
    }
  }
});

test('tester LLM invokers consume AIConfig bindings and fail closed without binding', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const unavailable = read('src/tester/tester-unavailable.ts');
  const sdkAiConfigBinding = read('../../sdks/typescript/core/ai/config-runtime-binding.ts');
  const kitAiConsume = read('../../kit/features/generation/src/runtime-ai-consume.ts');
  const llmInvokers = invokers.slice(
    invokers.indexOf('async function invokeTextGenerate'),
    invokers.indexOf('function summariseArtifact'),
  );

  assert.doesNotMatch(llmInvokers, /model:\s*['"]auto['"]/);
  assert.match(unavailable, /ai-config-binding-missing/);
  assert.match(invokers, /resolveTesterLLMBinding/);
  assert.match(invokers, /resolveTextGenerationParameters/);
  assert.match(invokers, /coerceNimiAITextGenerationParams/);
  assert.doesNotMatch(invokers, /optionalFiniteParam\(capabilityId, params, 'temperature'\)/);
  assert.doesNotMatch(invokers, /optionalPositiveIntegerParam\(capabilityId, params, 'timeoutMs'\)/);
  assert.match(sdkAiConfigBinding, /function optionalFiniteParam\(params: Record<string, unknown>, key: string\)/);
  assert.match(sdkAiConfigBinding, /function optionalPositiveIntegerParam\(params: Record<string, unknown>, key: string\)/);
  assert.match(sdkAiConfigBinding, /stopSequences/);
  assert.match(sdkAiConfigBinding, /must be a finite number/);
  assert.match(sdkAiConfigBinding, /must be a positive integer/);
  assert.match(invokers, /runRuntimeAIConsumeCapability/);
  assert.match(kitAiConsume, /coerceNimiAITextGenerationParams\(binding\.selectedParams\)/);
  assert.match(kitAiConsume, /\.\.\.textParams\.value\.parameters/);
  assert.match(kitAiConsume, /timeoutMs: textParams\.value\.timeoutMs/);
  assert.match(kitAiConsume, /runtimeUnavailableReasonFromError/);
  assert.match(kitAiConsume, /describeRuntimeGenerationError/);
  assert.doesNotMatch(kitAiConsume, /ReasonCode/);
  assert.doesNotMatch(kitAiConsume, /function providerDetailFromError/);
  assert.match(invokers, /Extract<TesterCapabilityId, 'text\.generate' \| 'text\.embed'>/);
  assert.match(invokers, /case 'text\.embed':\s*return invokeEmbedding/);
  assert.match(sdkAiConfigBinding, /runtime invocation failed closed before request dispatch/);
  assert.match(sdkAiConfigBinding, /input\.config\.capabilities\.targetRefs\[bindingCapabilityId\]/);
  assert.match(sdkAiConfigBinding, /targetRef\.kind === 'profile-slice'/);
  assert.match(sdkAiConfigBinding, /targetRef\.kind === 'cloud-connector'/);
  assert.match(sdkAiConfigBinding, /targetRef\.kind === 'local-runtime'/);
  assert.match(invokers, /connectorId: resolved\.connectorId/);
  assert.match(invokers, /route: 'local'/);
  assert.match(sdkAiConfigBinding, /aiConfigScopeKind/);
  assert.match(sdkAiConfigBinding, /aiConfigProfileId/);
  assert.match(sdkAiConfigBinding, /aiConfigBindingCapabilityId/);
  assert.match(sdkAiConfigBinding, /aiConfigBindingModel/);
  assert.match(sdkAiConfigBinding, /aiConfigTargetRefKind/);
  assert.match(sdkAiConfigBinding, /aiConfigHash/);
  assert.match(sdkAiConfigBinding, /versionNimiAIConfig/);
  assert.match(invokers, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(invokers, /createNimiRuntimeAISchedulingClient/);
  assert.match(invokers, /client\.runtime/);
  assert.match(invokers, /from '@nimiplatform\/kit\/features\/generation\/runtime'/);
  assert.doesNotMatch(invokers, /createTesterTextModel/);
  assert.doesNotMatch(invokers, /buildNimiUserMessages/);
  assert.doesNotMatch(invokers, /resolveAIConfigRuntimeSchedulingTargetForCapability/);
  assert.doesNotMatch(invokers, /peekRuntimeSchedulingBatch/);
  assert.doesNotMatch(invokers, /client\.runtime\.ai\.peekScheduling/);

  const kitImageRuntime = read('../../kit/features/generation/src/runtime-image-generate.ts');
  const kitVideoRuntime = read('../../kit/features/generation/src/runtime-video-generate.ts');
  const kitTranscribeRuntime = read('../../kit/features/generation/src/runtime-speech-transcribe.ts');
  const sdkMediaParams = readFileSync(path.join(root, '..', '..', 'sdks', 'typescript', 'features', 'generation', 'media-params.ts'), 'utf8');
  const mediaInvokers = readTesterRuntimeInvokersSurface(root);
  assert.equal(existsSync(path.join(root, 'src/tester/tester-runtime-media-bindings.ts')), false);
  assert.match(kitImageRuntime, /function imageProfileExtensionsFromBinding/);
  assert.match(kitImageRuntime, /\.\.\.imageParams\.providerOptions,\s*profile_overrides:/);
  assert.match(kitImageRuntime, /profile_entries:/);
  assert.equal(existsSync(path.join(root, 'src/tester/tester-runtime-invokers-media-params.ts')), false);
  assert.match(sdkMediaParams, /2k/);
  assert.match(sdkMediaParams, /3k/);
  assert.match(sdkMediaParams, /4k/);
  assert.doesNotMatch(mediaInvokers, /imageParamsFromBinding/);
  assert.match(mediaInvokers, /runRuntimeVideoGenerate/);
  assert.match(mediaInvokers, /runRuntimeSpeechTranscribe/);
  assert.match(kitVideoRuntime, /coerceNimiVideoGenerationParams/);
  assert.match(kitVideoRuntime, /mode: input\.params\.mode/);
  assert.match(kitVideoRuntime, /negativePrompt: input\.params\.negativePrompt/);
  assert.match(kitVideoRuntime, /options: input\.params\.options/);
  assert.match(kitTranscribeRuntime, /coerceNimiSpeechTranscriptionParams/);
  assert.match(kitTranscribeRuntime, /speakerCount: input\.params\.speakerCount/);
  assert.match(kitTranscribeRuntime, /diarization: input\.params\.diarization/);
  assert.match(kitTranscribeRuntime, /signal: input\.input\.signal/);
  assert.match(kitTranscribeRuntime, /abortReason: input\.input\.abortReason/);
});

test('Kit voice catalog consumer API avoids generated voice request/response types', () => {
  const kitVoiceCatalog = read('../../kit/features/generation/src/runtime-voice-catalog.ts');
  const sdkContract = read('../../kit/core/src/sdk-contract.ts');
  assert.doesNotMatch(kitVoiceCatalog, /ListPresetVoicesRequest/);
  assert.doesNotMatch(kitVoiceCatalog, /ListPresetVoicesResponse/);
  assert.doesNotMatch(sdkContract, /ListPresetVoicesRequest/);
  assert.doesNotMatch(sdkContract, /ListPresetVoicesResponse/);
  assert.doesNotMatch(sdkContract, /export \{[^}]*runNimiRuntimeScenarioJob/s);
  assert.match(sdkContract, /runKitRuntimeScenarioJob/);
  assert.match(kitVoiceCatalog, /signal\?: AbortSignal/);
  assert.match(kitVoiceCatalog, /withScopes\?: RuntimeVoiceCatalogScopeRunner/);
});

test('tester LLM invoker dispatches configured AIConfig route payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
          providerModelId: 'runtime-model',
        },
        'text.embed': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'embedding-model',
        },
      },
      selectedParams: {},
    },
    profileOrigin: {
      profileId: 'behavior-profile',
      title: 'Behavior Profile',
      appliedAt: '2026-05-26T00:00:00.000Z',
    },
  });

  const captured = [];
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input, options) {
          captured.push({ surface: 'peekScheduling', input, options });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input, options) {
          captured.push({ surface: 'executeScenario', input, options });
          if (input.scenarioType === RUNTIME_SCENARIO_TYPE_TEXT_EMBED) {
            return textEmbedScenarioResponse(input);
          }
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input, options) {
          captured.push({ surface: 'streamScenario', input, options });
          return textScenarioStream(input);
        },
      },
    },
  };

  const textResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello runtime',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(textResult.ok, true);

  const streamResult = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(streamResult.ok, true);

  const embedResult = await invokers.invokeTesterCapability(client, 'text.embed', {
    prompt: 'Hello embed',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(embedResult.ok, true);

  assert.deepEqual(captured.map((entry) => entry.surface), [
    'peekScheduling',
    'executeScenario',
    'peekScheduling',
    'streamScenario',
    'peekScheduling',
    'executeScenario',
  ]);
  assert.equal(captured[0].input.targets[0].targetId, 'runtime-connector');
  assert.equal(captured[0].input.targets[0].profileId, 'runtime-model');
  assert.equal(captured[1].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(captured[1].input.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(captured[1].input.head.modelId, 'runtime-model');
  assert.equal(captured[1].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[1].input.head.connectorId, 'runtime-connector');
  assert.equal(captured[1].input.head.routePolicy, RUNTIME_ROUTE_POLICY_CLOUD);
  assert.equal(captured[1].options.metadata.aiConfigProfileId, 'behavior-profile');
  assert.equal(captured[1].options.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(captured[1].options.metadata.aiConfigTargetRefKind, 'cloud-connector');
  assert.equal(captured[3].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(captured[3].input.executionMode, RUNTIME_EXECUTION_MODE_STREAM);
  assert.equal(captured[3].input.head.modelId, 'runtime-model');
  assert.equal(captured[3].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[3].input.head.connectorId, 'runtime-connector');
  assert.equal(captured[3].input.head.routePolicy, RUNTIME_ROUTE_POLICY_CLOUD);
  assert.equal(captured[3].options.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(captured[4].input.targets[0].capability, 'text.embed');
  assert.equal(captured[4].input.targets[0].targetId, 'embedding-model');
  assert.equal(captured[4].input.targets[0].profileId, 'embedding-model');
  assert.equal(captured[5].input.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_EMBED);
  assert.equal(captured[5].input.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(captured[5].input.head.modelId, 'embedding-model');
  assert.equal(captured[5].input.head.subjectUserId, 'subject-user-1');
  assert.equal(captured[5].input.head.connectorId, '');
  assert.equal(captured[5].input.head.routePolicy, RUNTIME_ROUTE_POLICY_LOCAL);
  assert.equal(captured[5].options.metadata.aiConfigBindingCapabilityId, 'text.embed');
  assert.equal(captured[5].options.metadata.runtimeSchedulingState, 'runnable');
  assert.equal(Object.hasOwn(captured[5].options.metadata, 'runtimeSchedulingDetail'), false);
});

test('tester chat.stream surfaces Runtime stream failure reason names instead of numeric proto codes', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:missing-model',
          providerModelId: 'missing-model',
        },
      },
      selectedParams: {},
    },
    profileOrigin: {
      profileId: 'stream-failure-profile',
      title: 'Stream Failure Profile',
      appliedAt: '2026-06-27T00:00:00.000Z',
    },
  });

  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          throw new Error('executeScenario should not run for chat.stream');
        },
        async *streamScenario() {
          yield {
            eventType: 7,
            sequence: '1',
            traceId: 'trace-stream-failure',
            payload: {
              oneofKind: 'failed',
              failed: {
                reasonCode: RUNTIME_REASON_CODE_AI_MODEL_NOT_FOUND,
                actionHint: 'retry stream request',
              },
            },
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream failure',
    scenarioId: 'stream-failure',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /^AI_MODEL_NOT_FOUND: retry stream request$/);
  assert.doesNotMatch(result.message, /^200:/);
});

test('tester LLM invokers forward selectedParams and timeout to Runtime payloads', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          temperature: '0.25',
          topP: 0.8,
          topK: '40',
          maxTokens: '128',
          presencePenalty: '0.1',
          frequencyPenalty: '0.2',
          stopSequences: ['END', ''],
          timeoutMs: '90000',
        },
      },
    },
    profileOrigin: {
      profileId: 'params-profile',
      title: 'Params Profile',
      appliedAt: '2026-06-03T00:00:00.000Z',
    },
  });

  const captured = [];
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input, options) {
          captured.push({ surface: 'peekScheduling', input, options });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input, options) {
          captured.push({ surface: 'executeScenario', input, options });
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input, options) {
          captured.push({ surface: 'streamScenario', input, options });
          return textScenarioStream(input);
        },
      },
    },
  };

  const textResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello with params',
    scenarioId: 'selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(textResult.ok, true);

  const streamResult = await invokers.invokeTesterCapability(client, 'chat.stream', {
    prompt: 'Hello stream params',
    scenarioId: 'selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(streamResult.ok, true);

  const generateCall = captured.find((entry) => entry.surface === 'executeScenario');
  const generateSpec = generateCall.input.spec.spec.textGenerate;
  assert.equal(generateCall.input.head.timeoutMs, 90000);
  assert.equal(generateSpec.temperature, 0.25);
  assert.equal(generateSpec.topP, 0.8);
  assert.equal(generateSpec.topK, 40);
  assert.equal(generateSpec.maxTokens, 128);
  assert.equal(generateSpec.presencePenalty, 0.1);
  assert.equal(generateSpec.frequencyPenalty, 0.2);
  assert.deepEqual(generateSpec.stop, ['END']);
  assert.equal(generateCall.options.metadata.aiConfigBindingCapabilityId, 'text.generate');

  const streamCall = captured.find((entry) => entry.surface === 'streamScenario');
  const streamSpec = streamCall.input.spec.spec.textGenerate;
  assert.equal(streamCall.input.head.timeoutMs, 90000);
  assert.equal(streamSpec.temperature, 0.25);
  assert.equal(streamSpec.topP, 0.8);
  assert.equal(streamSpec.maxTokens, 128);
  assert.equal(streamSpec.topK, 0);
  assert.equal(streamSpec.presencePenalty, 0);
  assert.equal(streamSpec.frequencyPenalty, 0);
  assert.deepEqual(streamSpec.stop, []);
});

test('tester LLM selectedParams validation fails closed before dispatch', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          maxTokens: 'not-a-number',
        },
      },
    },
    profileOrigin: null,
  });

  const captured = [];
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input) {
          captured.push({ surface: 'peekScheduling', input });
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input) {
          captured.push({ surface: 'executeScenario', input });
          return textGenerateScenarioResponse(input);
        },
        streamScenario(input) {
          captured.push({ surface: 'streamScenario', input });
          return textScenarioStream(input);
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'This must not dispatch',
    scenarioId: 'invalid-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'input-invalid');
  assert.match(result.message, /selectedParams\.maxTokens must be a finite number/);
  assert.deepEqual(captured, []);

  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
          providerModelId: 'runtime-model',
        },
      },
      selectedParams: {
        'text.generate': {
          maxTokens: '12.5',
        },
      },
    },
    profileOrigin: null,
  });

  const fractionalResult = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'This fractional integer must not dispatch',
    scenarioId: 'fractional-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(fractionalResult.ok, false);
  assert.equal(fractionalResult.reason, 'input-invalid');
  assert.match(fractionalResult.message, /selectedParams\.maxTokens must be a positive integer/);
  assert.deepEqual(captured, []);
});

test('tester video invoker forwards selected media params to Runtime Scenario job', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'video.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-video-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-video-connector:runtime-video-model',
          providerModelId: 'runtime-video-model',
        },
      },
      selectedParams: {
        'video.generate': {
          mode: 't2v',
          negativePrompt: 'blur',
          ratio: '9:16',
          durationSec: '6',
          resolution: '720p',
          fps: '24',
          seed: '42',
          cameraFixed: true,
          generateAudio: true,
          timeoutMs: '123000',
        },
      },
    },
    profileOrigin: {
      profileId: 'video-profile',
      title: 'Video Profile',
      appliedAt: '2026-06-03T00:00:00.000Z',
    },
  });

  let capturedVideo = null;
  const jobs = new Map();
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          throw new Error('executeScenario should not run for media Scenario jobs');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
        async submitScenarioJob(request) {
          capturedVideo = request;
          const job = {
            jobId: 'video-job-1',
            status: 4,
            scenarioType: request.scenarioType,
            traceId: 'video-trace-1',
            modelResolved: request.head.modelId,
            routeDecision: request.head.routePolicy,
            artifacts: [],
          };
          jobs.set(job.jobId, job);
          return { job };
        },
        async *subscribeScenarioJobEvents({ jobId }) {
          yield {
            eventType: 4,
            sequence: '1',
            traceId: jobs.get(jobId)?.traceId || '',
            job: jobs.get(jobId),
          };
        },
        async getScenarioJob({ jobId }) {
          return { job: jobs.get(jobId) };
        },
        async cancelScenarioJob() {
          return { job: undefined };
        },
        async getScenarioArtifacts({ jobId }) {
          const artifact = {
            artifactId: 'video-artifact-1',
            mimeType: 'video/mp4',
            uri: 'https://cdn.example/video.mp4',
            bytes: new Uint8Array(),
          };
          return {
            traceId: jobs.get(jobId)?.traceId || '',
            artifacts: [artifact],
            output: { output: { oneofKind: 'videoGenerate', videoGenerate: { artifacts: [artifact] } } },
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'video.generate', {
    prompt: 'Generate a moving product shot',
    scenarioId: 'video-selected-params',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  const videoSpec = capturedVideo.spec.spec.videoGenerate;
  assert.equal(videoSpec.mode, 1);
  assert.equal(capturedVideo.head.connectorId, 'runtime-video-connector');
  assert.equal(capturedVideo.head.modelId, 'runtime-video-model');
  assert.equal(capturedVideo.head.subjectUserId, 'subject-user-1');
  assert.equal(videoSpec.prompt, 'Generate a moving product shot');
  assert.equal(videoSpec.negativePrompt, 'blur');
  assert.equal(videoSpec.options.ratio, '9:16');
  assert.equal(videoSpec.options.durationSec, 6);
  assert.equal(videoSpec.options.resolution, '720p');
  assert.equal(videoSpec.options.fps, 24);
  assert.equal(videoSpec.options.seed, '42');
  assert.equal(videoSpec.options.cameraFixed, true);
  assert.equal(videoSpec.options.generateAudio, true);
  assert.equal(videoSpec.options.watermark, false);
  assert.equal(capturedVideo.head.timeoutMs, 123000);
  assert.equal(capturedVideo.labels.aiConfigBindingCapabilityId, 'video.generate');
});

test('tester local text.generate binding omits runtime connectorId payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: runtimeLocalModelId,
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let capturedInput = null;
  let capturedSchedulingInput = null;
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling(input) {
          capturedSchedulingInput = input;
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario(input) {
          capturedInput = input;
          return textGenerateScenarioResponse(input, 'trace-local', 'nimi runtime llm ok');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Reply with exactly: nimi runtime llm ok',
    scenarioId: 'local-behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  assert.equal(capturedInput.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(capturedInput.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(capturedInput.head.modelId, runtimeLocalModelId);
  assert.equal(capturedInput.head.subjectUserId, 'subject-user-1');
  assert.equal(capturedInput.head.routePolicy, RUNTIME_ROUTE_POLICY_LOCAL);
  assert.equal(capturedInput.head.connectorId, '');
  assert.deepEqual(capturedSchedulingInput.targets, [{
    capability: 'text.generate',
    targetId: runtimeLocalModelId,
    profileId: runtimeLocalModelId,
    resourceHint: undefined,
  }]);
});

test('tester Runtime failures surface provider metadata details', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          const error = new Error('provider request failed');
          error.reasonCode = 'AI_INPUT_INVALID';
          error.actionHint = 'check_input_and_extensions';
          error.retryable = false;
          error.details = {
            provider_message: 'llama.cpp rejected model id local/local-import/gemma-4-26B-A4B-it-Q8_0',
          };
          throw error;
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello provider detail',
    scenarioId: 'provider-detail',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /AI_INPUT_INVALID: provider request failed/);
  assert.match(
    result.message,
    /Provider detail: llama\.cpp rejected model id local\/local-import\/gemma-4-26B-A4B-it-Q8_0/,
  );
});

test('tester Runtime failures include the exact Runtime request diagnostics', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-connector:doubao-seed-2.0-pro',
          providerModelId: 'doubao-seed-2.0-pro',
        },
      },
      selectedParams: {
        'text.generate': {
          temperature: 0.2,
          maxTokens: 64,
          timeoutMs: 90000,
        },
      },
    },
    profileOrigin: {
      profileId: 'doubao-profile',
      title: 'Doubao Profile',
      appliedAt: '2026-06-28T00:00:00.000Z',
    },
  });

  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          const error = new Error('requested model is unavailable');
          error.reasonCode = 'AI_MODEL_NOT_FOUND';
          error.actionHint = 'switch_model_or_refresh_connector_models';
          throw error;
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'Hello model diagnostics',
    scenarioId: 'request-diagnostics',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.equal(result.runtimeRequest.request.scenarioType, RUNTIME_SCENARIO_TYPE_TEXT_GENERATE);
  assert.equal(result.runtimeRequest.request.executionMode, RUNTIME_EXECUTION_MODE_SYNC);
  assert.equal(result.runtimeRequest.request.head.modelId, 'doubao-seed-2.0-pro');
  assert.equal(result.runtimeRequest.request.head.connectorId, 'runtime-connector');
  assert.equal(result.runtimeRequest.request.head.routePolicy, RUNTIME_ROUTE_POLICY_CLOUD);
  assert.equal(result.runtimeRequest.request.head.timeoutMs, 90000);
  assert.equal(result.runtimeRequest.request.head.targetRef.target.oneofKind, 'cloud');
  assert.equal(result.runtimeRequest.request.head.targetRef.target.cloud.remoteModelCatalogId, 'remote-catalog:runtime-connector:doubao-seed-2.0-pro');
  assert.equal(result.runtimeRequest.request.spec.spec.textGenerate.input[0].content, 'Hello model diagnostics');
  assert.equal(result.runtimeRequest.request.spec.spec.textGenerate.temperature, 0.2);
  assert.equal(result.runtimeRequest.request.spec.spec.textGenerate.maxTokens, 64);
  assert.equal(result.runtimeRequest.options.metadata.aiConfigProfileId, 'doubao-profile');
  assert.equal(result.runtimeRequest.options.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(result.runtimeRequest.options.timeoutMs, 90000);
});

test('tester unavailable Runtime details render captured Runtime request diagnostics', () => {
  const outputSource = read('src/tester/workbench/section-ai-testing-output.tsx');
  assert.match(outputSource, /Runtime request:/);
  assert.match(outputSource, /result\.runtimeRequest/);
});

test('tester local LLM scheduling denial fails closed before Runtime execution', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.chat.blocked',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  let generateCalled = false;
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return {
            occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
            aggregateJudgement: {
              state: RUNTIME_SCHEDULING_DENIED,
              detail: 'dependency missing',
              occupancy: { globalUsed: 1, globalCap: 1, appUsed: 1, appCap: 1 },
              resourceWarnings: ['dependency missing'],
            },
            targetJudgements: [],
          };
        },
      },
      ai: {
        async executeScenario() {
          generateCalled = true;
          throw new Error('executeScenario must not run after denied scheduling');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'text.generate', {
    prompt: 'blocked',
    scenarioId: 'blocked-scheduling',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /Runtime scheduling denied text\.generate: dependency missing/);
  assert.equal(generateCalled, false);
});
