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

test('tester surfaces inline runtime media artifact bytes as a previewable data URL', async (t) => {
  installMemoryStorageHarness(t);
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
          profileBindingId: 'local.image.test',
        },
        'audio.synthesize': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local.tts.test',
        },
      },
      selectedParams: {
        'image.generate': {
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            capability: 'image.generate',
            asset_id: 'local.image.test',
            asset_kind: 'image',
            required: true,
          }],
        },
        'audio.synthesize': {
          voiceRef: 'voice_asset_id:voice-asset-inline-audio',
        },
      },
    },
    profileOrigin: null,
  });

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
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
              localAssetId: 'local.tts.test',
              assetId: 'speech/qwen3-tts-test',
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
            jobId: `inline-job-${submitted.length}`,
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: `inline-trace-${submitted.length}`,
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
            const artifact = { artifactId: 'art-img', mimeType: 'image/png', uri: '', bytes: pngBytes };
            return {
              traceId: job.traceId,
              artifacts: [artifact],
              output: imageGenerationOutput([artifact]),
            };
          }
          if (job.scenarioType === RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE) {
            return {
              traceId: job.traceId,
              artifacts: [{ artifactId: 'art-tts', mimeType: 'audio/wav', uri: '', bytes: wavBytes }],
              output: {
                output: {
                  oneofKind: 'speechSynthesize',
                  speechSynthesize: {
                    artifacts: [{ artifactId: 'art-tts', mimeType: 'audio/wav', uri: '', bytes: wavBytes }],
                  },
                },
              },
            };
          }
          throw new Error(`unexpected scenario type ${job.scenarioType}`);
        },
      },
    },
  };

  const imageResult = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a glass ui panel',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(imageResult.ok, true);
  assert.equal(imageResult.output.kind, 'artifacts');
  const imageUrl = imageResult.output.firstArtifact?.url ?? '';
  assert.match(imageUrl, /^data:image\/png;base64,/);
  assert.deepEqual(new Uint8Array(Buffer.from(imageUrl.split(',')[1], 'base64')), pngBytes);

  const ttsResult = await invokers.invokeTesterCapability(client, 'audio.synthesize', {
    prompt: 'hello acceptance',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(ttsResult.ok, true);
  assert.equal(submitted[1]?.head?.modelId, 'speech/qwen3-tts-test');
  assert.equal(ttsResult.output.kind, 'artifacts');
  const ttsUrl = ttsResult.output.firstArtifact?.url ?? '';
  assert.match(ttsUrl, /^data:audio\/wav;base64,/);
  assert.deepEqual(new Uint8Array(Buffer.from(ttsUrl.split(',')[1], 'base64')), wavBytes);
});

test('image.generate forwards Scenario request identity to Runtime Scenario job', async (t) => {
  installMemoryStorageHarness(t);
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
          profileBindingId: 'local.image.identity',
        },
      },
      selectedParams: {
        'image.generate': {
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            capability: 'image.generate',
            asset_id: 'local.image.identity',
            asset_kind: 'image',
            required: true,
          }],
        },
      },
    },
    profileOrigin: null,
  });

  let capturedImage = null;
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
          capturedImage = request;
          const job = {
            jobId: 'img-job-identity',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'img-trace-identity',
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
          const artifact = { artifactId: 'art-img', mimeType: 'image/png', uri: '', bytes: new Uint8Array([1, 2, 3]) };
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
    prompt: 'identity probe',
    scenarioId: 'z-image-turbo-webview',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, true);
  assert.match(capturedImage?.requestId ?? '', /^nimi\.tester:image\.generate:z-image-turbo-webview:/);
  assert.equal(capturedImage?.idempotencyKey, capturedImage?.requestId);
  assert.equal(capturedImage?.labels?.surfaceId, 'nimi.tester.ai.image.generate');
});

test('tester prefers a hosted artifact uri over inline bytes', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-image-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-image-connector:cloud.image.test',
          providerModelId: 'cloud.image.test',
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
        async executeScenario() {
          throw new Error('executeScenario should not be called by media Scenario job lanes');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called by media Scenario job lanes');
        },
        async submitScenarioJob(request) {
          const job = {
            jobId: 'img-job-2',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'img-trace-2',
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
          const artifact = {
            artifactId: 'art-hosted',
            mimeType: 'image/png',
            uri: 'https://cdn.example/img.png',
            bytes: new Uint8Array([1, 2, 3]),
          };
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
    prompt: 'x',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.output.firstArtifact?.url, 'https://cdn.example/img.png');
});

test('tester reads compact runtime artifact bytes by id for image preview', async (t) => {
  installMemoryStorageHarness(t);
  const invokers = await importBehaviorModule('tester/tester-runtime-invokers.js');
  const store = await importBehaviorModule('tester/tester-ai-config-store.js');
  const scopeRef = store.createTesterAppLabAIScopeRef();
  await store.saveTesterAIConfig({
    scopeRef,
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'cloud-connector',
          connectorId: 'runtime-image-connector',
          remoteModelCatalogId: 'remote-catalog:runtime-image-connector:cloud.image.test',
          providerModelId: 'cloud.image.test',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22, 0x33, 0x44]);
  const artifactReads = [];
  const standardShellInvoke = globalThis.__NIMI_ELECTRON_TEST__.invoke;
  globalThis.__NIMI_ELECTRON_TEST__.invoke = async (command, payload = {}) => {
    if (command === 'nimi.shell.artifacts.readRuntimeBytes') {
      const body = payload?.payload ?? payload;
      artifactReads.push(body);
      return {
        dataBase64: Buffer.from(pngBytes).toString('base64'),
        mimeType: 'image/png',
        sizeBytes: pngBytes.byteLength,
        mimeInferred: false,
      };
    }
    return standardShellInvoke(command, payload);
  };
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
          throw new Error('executeScenario should not be called by this compact artifact test');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called by this compact artifact test');
        },
        async submitScenarioJob(request) {
          const job = {
            jobId: 'img-job-compact',
            status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED,
            scenarioType: request.scenarioType,
            traceId: 'img-compact-trace',
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
          const artifact = { artifactId: 'art-compact-img', mimeType: 'image/png', uri: '', bytes: new Uint8Array() };
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
    prompt: 'x',
    scenarioId: 'behavior',
    subjectUserId: 'subject-user-1',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(artifactReads, [{ artifactId: 'art-compact-img' }]);
  const imageUrl = result.output.firstArtifact?.url ?? '';
  assert.match(imageUrl, /^data:image\/png;base64,/);
  assert.deepEqual(new Uint8Array(Buffer.from(imageUrl.split(',')[1], 'base64')), pngBytes);
});
