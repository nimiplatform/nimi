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

test('audio.synthesize fails closed for local TTS without explicit voice reference', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'audio.synthesize': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.tts.qwen3',
        },
      },
      selectedParams: {
        'audio.synthesize': {
          responseFormat: 'mp3',
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
              localAssetId: 'local.tts.qwen3',
              assetId: 'speech/qwen3tts-base',
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
            jobId: 'job-default-voice',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'trace-default-voice',
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
        async getScenarioArtifacts() {
          const artifact = { artifactId: 'tts-art', mimeType: 'audio/mp3', uri: '', bytes: new Uint8Array([4, 5, 6]) };
          return {
            traceId: 'trace-default-voice',
            artifacts: [artifact],
            output: { output: { oneofKind: 'speechSynthesize', speechSynthesize: { artifacts: [artifact] } } },
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'audio.synthesize', {
    prompt: 'hello missing local voice',
    scenarioId: 'scenario-job',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /voice reference/i);
  assert.equal(submitted.length, 0);
});

test('audio.synthesize fails closed when Runtime Scenario job does not complete before client timeout', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'audio.synthesize': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-tts-timeout',
        },
      },
      selectedParams: {
        'audio.synthesize': {
          voiceRef: 'voice_asset_id:voice-asset-timeout',
          responseFormat: 'mp3',
          timeoutMs: '20',
        },
      },
    },
    profileOrigin: null,
  });

  let capturedRequest = null;
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        ...readyLocalImageEnvironmentMethods(),
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [{
              localAssetId: 'local-tts-timeout',
              assetId: 'speech/qwen3-tts-timeout',
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
        async submitScenarioJob(request) {
          capturedRequest = request;
          return {
            job: {
              jobId: 'job-timeout',
              status: 2,
              scenarioType: request.scenarioType,
              traceId: 'trace-timeout',
              modelResolved: request.head.modelId,
              routeDecision: request.head.routePolicy,
              artifacts: [],
            },
          };
        },
        async *subscribeScenarioJobEvents() {
          await new Promise(() => undefined);
        },
        async getScenarioJob() {
          return { job: undefined };
        },
        async cancelScenarioJob() {
          return { job: undefined };
        },
      },
    },
  };

  const startedAt = Date.now();
  const result = await invokers.invokeTesterCapability(client, 'audio.synthesize', {
    prompt: 'timeout probe',
    scenarioId: 'scenario-local-tts-timeout',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /audio\.synthesize Runtime call timed out after 20ms/);
  assert.equal(capturedRequest?.head?.modelId, 'speech/qwen3-tts-timeout');
  assert.equal(capturedRequest?.head?.timeoutMs, 20);
  assert.match(capturedRequest?.requestId ?? '', /^nimi\.tester:audio\.synthesize:scenario-local-tts-timeout:/);
  assert.equal(capturedRequest?.idempotencyKey, capturedRequest?.requestId);
  assert.ok(Date.now() - startedAt < 1000);
});
