import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_EXECUTION_MODE_STREAM,
  RUNTIME_EXECUTION_MODE_SYNC,
  RUNTIME_ROUTE_POLICY_CLOUD,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_SCENARIO_TYPE_TEXT_EMBED,
  RUNTIME_SCENARIO_TYPE_TEXT_GENERATE,
  RUNTIME_SCHEDULING_DENIED,
  cleanupBehaviorModules,
  createMemoryStorage,
  importBehaviorModule,
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

test('tester runtime media invokers use AIConfig bindings instead of executable auto routing', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.doesNotMatch(invokers, /model:\s*['"]auto['"]/);
  for (const capability of [
    'image.generate',
    'video.generate',
    'audio.synthesize',
    'audio.transcribe',
    'speech.bundle',
  ]) {
    assert.match(invokers, new RegExp(`resolveTesterLLMBinding\\('${capability}'\\)`));
  }
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

test('tester text.generate consumes SDK vNext text runner and Runtime Scenario model', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  assert.match(invokers, /runNimiTextGenerate/);
  assert.match(invokers, /createNimiRuntimeAIModel/);
  assert.match(invokers, /createNimiRuntimeEmbeddingClient/);
  assert.match(invokers, /NimiRuntimeAIScenarioClient/);
  assert.match(invokers, /runtime: client\.runtime/);
  assert.doesNotMatch(invokers, /@nimiplatform\/sdk\/ai-app/);
  assert.doesNotMatch(invokers, /runtime\.ai\.text\.generate/);
});

test('tester LLM invokers consume AIConfig bindings and fail closed without binding', () => {
  const invokers = readTesterRuntimeInvokersSurface(root);
  const unavailable = read('src/tester/tester-unavailable.ts');
  const sdkAiConfigBinding = read('../../sdks/typescript/core/ai/config-runtime-binding.ts');
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
  assert.match(invokers, /createTesterTextModel\(client, resolved, textParams\.timeoutMs\)/);
  assert.match(invokers, /\.\.\.textParams\.parameters/);
  assert.match(invokers, /temperature: textParams\.parameters\.temperature/);
  assert.match(invokers, /timeoutMs: textParams\.timeoutMs/);
  assert.match(invokers, /Extract<TesterCapabilityId, 'text\.generate' \| 'chat\.stream'>/);
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
  assert.doesNotMatch(invokers, /resolveAIConfigRuntimeSchedulingTargetForCapability/);
  assert.doesNotMatch(invokers, /peekRuntimeSchedulingBatch/);
  assert.doesNotMatch(invokers, /client\.runtime\.ai\.peekScheduling/);

  const mediaBindings = read('src/tester/tester-runtime-media-bindings.ts');
  const mediaInvokers = read('src/tester/tester-runtime-invokers-media.ts');
  assert.match(mediaBindings, /selectedParamRecord\(resolved\)/);
  assert.match(mediaBindings, /\.\.\.forwardedParams,\s*profile_entries:/);
  assert.match(mediaInvokers, /videoParamsFromBinding/);
  assert.match(mediaInvokers, /transcriptionParamsFromBinding/);
  assert.match(mediaInvokers, /mode: videoParams\.mode/);
  assert.match(mediaInvokers, /negativePrompt: videoParams\.negativePrompt/);
  assert.match(mediaInvokers, /options: videoParams\.options/);
  assert.match(mediaInvokers, /speakerCount: transcriptionParams\.speakerCount/);
  assert.match(mediaInvokers, /diarization: transcriptionParams\.diarization/);
  assert.match(mediaInvokers, /timeoutMs,\s*signal/s);
});

test('tester LLM invoker dispatches configured AIConfig route payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
          providerModelId: 'runtime-model',
        },
        'text.embed': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'embedding-model',
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
  assert.equal(captured[4].input.targets[0].targetId, 'core:runtime');
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

test('tester LLM invokers forward selectedParams and timeout to Runtime payloads', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
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
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
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

  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-connector',
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

test('tester video invoker forwards selected media params to Runtime media lane', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'video.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-video-connector',
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
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          throw new Error('executeScenario should not run when media.video.generate is available');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called');
        },
      },
      media: {
        video: {
          async generate(input) {
            capturedVideo = input;
            return {
              job: {
                jobId: 'video-job-1',
                state: 'completed',
                modelResolved: 'runtime-video-model',
                routeDecision: 'cloud',
                traceId: 'video-trace-1',
              },
              artifacts: [],
              traceId: 'video-trace-1',
            };
          },
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
  assert.equal(capturedVideo.mode, 't2v');
  assert.equal(capturedVideo.connectorId, 'runtime-video-connector');
  assert.equal(capturedVideo.model, 'runtime-video-model');
  assert.equal(capturedVideo.subjectUserId, 'subject-user-1');
  assert.equal(capturedVideo.prompt, 'Generate a moving product shot');
  assert.equal(capturedVideo.negativePrompt, 'blur');
  assert.deepEqual(capturedVideo.options, {
    ratio: '9:16',
    durationSec: 6,
    resolution: '720p',
    fps: 24,
    seed: '42',
    cameraFixed: true,
    generateAudio: true,
  });
  assert.equal(capturedVideo.timeoutMs, 123000);
  assert.equal(capturedVideo.signal instanceof AbortSignal, true);
  assert.equal(capturedVideo.metadata.aiConfigBindingCapabilityId, 'video.generate');
});

test('tester local text.generate binding omits runtime connectorId payload', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const runtimeLocalModelId = 'local.chat.gemma-4-e2b-it.q8-0';
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: runtimeLocalModelId,
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
    targetId: 'core:runtime',
    profileId: runtimeLocalModelId,
    resourceHint: undefined,
  }]);
});

test('tester Runtime failures surface provider metadata details', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
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

test('tester local LLM scheduling denial fails closed before Runtime execution', async () => {
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local.chat.blocked',
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
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /Runtime scheduling denied text\.generate: dependency missing/);
  assert.equal(generateCalled, false);
});
