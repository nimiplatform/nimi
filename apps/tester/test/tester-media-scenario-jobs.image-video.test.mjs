import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  RUNTIME_EXECUTION_MODE_ASYNC_JOB,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
  RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE,
  RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
  RUNTIME_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
  RUNTIME_VOICE_ASSET_STATUS_ACTIVE,
  imageGenerationOutput,
  importBehaviorModule,
  installMemoryStorageHarness,
  protoListValues,
  protoNumber,
  protoString,
  protoStructFields,
  readyLocalImageEnvironmentMethods,
  runnableSchedulingResponse,
} from './tester-media-scenario-jobs.helpers.mjs';

test('tester media lanes dispatch through Runtime Scenario jobs', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.image.scenario',
        },
        'audio.synthesize': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.tts.scenario',
        },
        'audio.transcribe': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.stt.scenario',
        },
      },
      selectedParams: {
        'image.generate': {
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            capability: 'image.generate',
            asset_id: 'local.image.scenario',
            asset_kind: 'image',
            required: true,
          }],
        },
        'audio.synthesize': {
          voiceRef: 'preset_voice_id:aiden',
          responseFormat: 'wav',
          languageHint: 'en-US',
          speakingRate: '1.15',
          volume: '0.9',
          pitchSemitones: '2',
          timeoutMs: '180000',
        },
      },
    },
    profileOrigin: null,
  });

  const submitted = [];
  const jobs = new Map();
  const client = {
    runtime: {
      local: {
        ...readyLocalImageEnvironmentMethods(),
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [{
              localAssetId: 'local.tts.scenario',
              assetId: 'speech/qwen3-tts-local',
              kind: 'tts',
              engine: 'speech',
              status: 'active',
            }],
          };
        },
      },
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async executeScenario() {
          throw new Error('executeScenario should not be called by media Scenario job lanes');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called by media Scenario job lanes');
        },
        async submitScenarioJob(request) {
          submitted.push(request);
          const job = {
            jobId: `job-${submitted.length}`,
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: `trace-${submitted.length}`,
            modelResolved: request.head.modelId,
            routeDecision: request.head.routePolicy,
            artifacts: [],
          };
          jobs.set(job.jobId, job);
          return { job };
        },
        async *subscribeScenarioJobEvents({ jobId }) {
          yield {
            eventType: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
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
          const job = jobs.get(jobId);
          if (job.scenarioType === RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE) {
            const artifact = { artifactId: 'img-art', mimeType: 'image/png', uri: '', bytes: new Uint8Array([1, 2, 3]) };
            return {
              traceId: job.traceId,
              artifacts: [artifact],
              output: imageGenerationOutput([artifact]),
            };
          }
          if (job.scenarioType === RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE) {
            const artifact = { artifactId: 'tts-art', mimeType: 'audio/wav', uri: '', bytes: new Uint8Array([4, 5, 6]) };
            return {
              traceId: job.traceId,
              artifacts: [artifact],
              output: { output: { oneofKind: 'speechSynthesize', speechSynthesize: { artifacts: [artifact] } } },
            };
          }
          return {
            traceId: job.traceId,
            artifacts: [],
            output: {
              output: {
                oneofKind: 'speechTranscribe',
                speechTranscribe: { text: 'accepted transcript', artifacts: [] },
              },
            },
          };
        },
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'audio/wav; charset=binary' : null },
    arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
  });

  let image;
  let tts;
  let stt;
  try {
    image = await invokers.invokeTesterCapability(client, 'image.generate', {
      prompt: 'a glass ui panel',
      scenarioId: 'scenario-job',
      subjectUserId: 'subject-user-1',
    });
    tts = await invokers.invokeTesterCapability(client, 'audio.synthesize', {
      prompt: 'hello acceptance',
      scenarioId: 'scenario-job',
      subjectUserId: 'subject-user-1',
    });
    stt = await invokers.invokeTesterCapability(client, 'audio.transcribe', {
      prompt: 'https://example.com/sample.wav',
      scenarioId: 'scenario-job',
      subjectUserId: 'subject-user-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(image.ok, true);
  assert.equal(image.output.kind, 'artifacts');
  assert.match(image.output.firstArtifact?.url ?? '', /^data:image\/png;base64,/);
  assert.equal(tts.ok, true);
  assert.equal(tts.output.kind, 'artifacts');
  assert.match(tts.output.firstArtifact?.url ?? '', /^data:audio\/wav;base64,/);
  assert.equal(stt.ok, true);
  assert.equal(stt.output.kind, 'transcript');
  assert.equal(stt.output.text, 'accepted transcript');

  assert.deepEqual(submitted.map((request) => request.scenarioType), [
    RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE,
    RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
    RUNTIME_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
  ]);
  assert.deepEqual(submitted.map((request) => request.executionMode), [
    RUNTIME_EXECUTION_MODE_ASYNC_JOB,
    RUNTIME_EXECUTION_MODE_ASYNC_JOB,
    RUNTIME_EXECUTION_MODE_ASYNC_JOB,
  ]);
  assert.deepEqual(submitted.map((request) => request.head.modelId), [
    'local.image.scenario',
    'speech/qwen3-tts-local',
    'local.stt.scenario',
  ]);
  assert.deepEqual(submitted.map((request) => request.head.subjectUserId), [
    'subject-user-1',
    'subject-user-1',
    'subject-user-1',
  ]);
  assert.deepEqual(submitted.map((request) => request.head.routePolicy), [
    RUNTIME_ROUTE_POLICY_LOCAL,
    RUNTIME_ROUTE_POLICY_LOCAL,
    RUNTIME_ROUTE_POLICY_LOCAL,
  ]);
  assert.deepEqual(submitted.map((request) => request.head.targetRef), [
    {
      target: {
        oneofKind: 'localRuntime',
        localRuntime: {
          version: 'v2',
          ref: { oneofKind: 'profileBindingId', profileBindingId: 'local.image.scenario' },
        },
      },
    },
    {
      target: {
        oneofKind: 'localRuntime',
        localRuntime: {
          version: 'v2',
          ref: { oneofKind: 'profileBindingId', profileBindingId: 'local.tts.scenario' },
        },
      },
    },
    {
      target: {
        oneofKind: 'localRuntime',
        localRuntime: {
          version: 'v2',
          ref: { oneofKind: 'profileBindingId', profileBindingId: 'local.stt.scenario' },
        },
      },
    },
  ]);
  assert.deepEqual(submitted.map((request) => request.spec.spec.oneofKind), [
    'imageGenerate',
    'speechSynthesize',
    'speechTranscribe',
  ]);
  assert.equal(submitted[0].extensions[0]?.namespace, 'nimi.scenario.image.request');
  assert.equal(
    submitted[1].spec.spec.speechSynthesize.voiceRef.reference.presetVoiceId,
    'aiden',
  );
  assert.equal(submitted[1].spec.spec.speechSynthesize.audioFormat, 'wav');
  assert.equal(submitted[1].spec.spec.speechSynthesize.language, 'en-US');
  assert.equal(submitted[1].spec.spec.speechSynthesize.speed, 1.15);
  assert.equal(submitted[1].spec.spec.speechSynthesize.volume, 0.9);
  assert.equal(submitted[1].spec.spec.speechSynthesize.pitch, 2);
  assert.equal(submitted[1].head.timeoutMs, 180000);
  assert.equal(
    submitted[2].spec.spec.speechTranscribe.audioSource.source.oneofKind,
    'audioBytes',
  );
  assert.deepEqual(
    submitted[2].spec.spec.speechTranscribe.audioSource.source.audioBytes,
    new Uint8Array([7, 8, 9]),
  );
  assert.equal(submitted[2].spec.spec.speechTranscribe.mimeType, 'audio/wav');
});

test('image.generate maps selected UI params to Runtime image spec and omits provider default sentinels', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.image.params',
        },
      },
      selectedParams: {
        'image.generate': {
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            capability: 'image.generate',
            asset_id: 'local.image.params',
            asset_kind: 'image',
            required: true,
          }],
          size: '512x512',
          responseFormat: 'auto',
          seed: 'Random',
          timeoutMs: '600000',
          steps: '25',
          cfgScale: 'Default',
          sampler: 'Default',
          scheduler: 'Default',
          negativePrompt: 'blur',
        },
      },
    },
    profileOrigin: null,
  });

  let submitted = null;
  const jobs = new Map();
  const client = {
    runtime: {
      local: readyLocalImageEnvironmentMethods(),
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async submitScenarioJob(request) {
          submitted = request;
          const job = {
            jobId: 'job-image-params',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'trace-image-params',
            modelResolved: request.head.modelId,
            routeDecision: request.head.routePolicy,
            artifacts: [],
          };
          jobs.set(job.jobId, job);
          return { job };
        },
        async *subscribeScenarioJobEvents({ jobId }) {
          yield {
            eventType: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
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
          const artifact = { artifactId: 'img-art', mimeType: 'image/png', uri: '', bytes: new Uint8Array([1, 2, 3]) };
          return {
            traceId: jobs.get(jobId)?.traceId || '',
            artifacts: [artifact],
            output: imageGenerationOutput([artifact]),
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a glass ui panel',
    scenarioId: 'image-params',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, true);
  assert.equal(submitted.scenarioType, RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE);
  assert.equal(submitted.spec.spec.imageGenerate.prompt, 'a glass ui panel');
  assert.equal(submitted.spec.spec.imageGenerate.size, '512x512');
  assert.equal(submitted.spec.spec.imageGenerate.negativePrompt, 'blur');
  assert.equal(submitted.spec.spec.imageGenerate.responseFormat, '');
  assert.equal(submitted.spec.spec.imageGenerate.seed, '0');
  assert.equal(submitted.head.timeoutMs, 600000);

  const fields = submitted.extensions[0]?.payload?.fields ?? {};
  assert.equal(protoString(fields.responseFormat), '');
  assert.equal(protoString(fields.seed), '');
  assert.equal(protoString(fields.timeoutMs), '');
  assert.equal(protoString(fields.cfgScale), '');
  assert.equal(protoString(fields.sampler), '');
  assert.equal(protoString(fields.scheduler), '');
  assert.equal(protoNumber(fields.steps), 25);
  assert.ok(fields.profile_entries);
});
