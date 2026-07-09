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

test('tester media invokers do not declare an app-local Runtime media facade', () => {
  const sources = [
    '../src/tester/tester-runtime-invokers-core.ts',
    '../src/tester/tester-runtime-invokers-media-image-video.ts',
    '../src/tester/tester-runtime-invokers-media-speech.ts',
  ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.match(sources, /runRuntimeSpeechSynthesize/);
  assert.match(sources, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.doesNotMatch(sources, /runNimiRuntimeSpeechSynthesis/);
  assert.doesNotMatch(sources, /runtime\.media/);
  assert.doesNotMatch(sources, /readonly media\?:/);
  assert.doesNotMatch(sources, /media facade compatibility/i);
});

test('tester media Runtime failures include Kit-captured request diagnostics', async (t) => {
  installMemoryStorageHarness(t);
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
          timeoutMs: '90000',
        },
      },
    },
    profileOrigin: {
      profileId: 'video-profile',
      title: 'Video Profile',
      appliedAt: '2026-07-09T00:00:00.000Z',
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
        async submitScenarioJob() {
          const error = new Error('video provider unavailable');
          error.reasonCode = 'AI_MODEL_NOT_FOUND';
          throw error;
        },
        subscribeScenarioJobEvents() {
          throw new Error('subscribeScenarioJobEvents should not run after submit failure');
        },
        async getScenarioJob() {
          throw new Error('getScenarioJob should not run after submit failure');
        },
        async cancelScenarioJob() {
          return { job: undefined };
        },
        async getScenarioArtifacts() {
          throw new Error('getScenarioArtifacts should not run after submit failure');
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'video.generate', {
    prompt: 'diagnostic video prompt',
    scenarioId: 'video-request-diagnostics',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.equal(result.runtimeRequest.request.scenarioType, 4);
  assert.equal(result.runtimeRequest.request.executionMode, RUNTIME_EXECUTION_MODE_ASYNC_JOB);
  assert.equal(result.runtimeRequest.request.head.modelId, 'runtime-video-model');
  assert.equal(result.runtimeRequest.request.head.connectorId, 'runtime-video-connector');
  assert.equal(result.runtimeRequest.request.head.timeoutMs, 90000);
  assert.equal(result.runtimeRequest.options.metadata.aiConfigProfileId, 'video-profile');
  assert.equal(result.runtimeRequest.options.metadata.aiConfigBindingCapabilityId, 'video.generate');
  assert.equal(result.runtimeRequest.options.timeoutMs, 90000);
});

test('image.generate uses Kit image generation consumer and fails closed without typed image artifact', async (t) => {
  installMemoryStorageHarness(t);
  const source = readFileSync(new URL('../src/tester/tester-runtime-invokers-media-image-video.ts', import.meta.url), 'utf8');
  assert.match(source, /runRuntimeImageGenerate/);
  assert.match(source, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.doesNotMatch(source, /runNimiRuntimeImageGeneration/);
  assert.doesNotMatch(source, /buildNimiRuntimeGenerationSubmitRequest[\s\S]*scenario:\s*\{\s*kind:\s*'image'/);

  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.image.no-artifact',
        },
      },
      selectedParams: {
        'image.generate': {
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            capability: 'image.generate',
            asset_id: 'local.image.no-artifact',
            asset_kind: 'image',
            required: true,
          }],
        },
      },
    },
    profileOrigin: null,
  });

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
          const job = {
            jobId: 'image-empty-job',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'image-empty-trace',
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
          return {
            traceId: jobs.get(jobId)?.traceId || '',
            artifacts: [],
            output: { output: { oneofKind: undefined } },
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'must fail closed when runtime has no image artifact',
    scenarioId: 'image-empty-artifact',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /image generation.*(missing|no image artifact|imageGenerate)/i);
});

test('video.generate fails closed when completed Runtime job has no video artifact', async (t) => {
  installMemoryStorageHarness(t);
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
      selectedParams: {},
    },
    profileOrigin: null,
  });

  const jobs = new Map();
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      ai: {
        async submitScenarioJob(request) {
          const job = {
            jobId: 'video-empty-job',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'video-empty-trace',
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
          return {
            traceId: jobs.get(jobId)?.traceId || '',
            artifacts: [],
            output: { output: { oneofKind: 'videoGenerate', videoGenerate: { artifacts: [] } } },
          };
        },
      },
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'video.generate', {
    prompt: 'must fail closed when runtime has no video artifact',
    scenarioId: 'video-empty-artifact',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.match(result.message, /video generation returned no video artifact/i);
});
