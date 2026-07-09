import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE = 3;
const RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE = 5;
const RUNTIME_SCENARIO_TYPE_SPEECH_TRANSCRIBE = 6;
const RUNTIME_EXECUTION_MODE_ASYNC_JOB = 3;
const RUNTIME_ROUTE_POLICY_LOCAL = 1;
const RUNTIME_SCENARIO_JOB_STATUS_COMPLETED = 4;
const RUNTIME_SCHEDULING_RUNNABLE = 1;
const RUNTIME_VOICE_ASSET_STATUS_ACTIVE = 1;

let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'media-scenario-jobs-'));
  buildWithTsc([
    '--outDir', behaviorBuildDir,
    '--rootDir', 'src',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--jsx', 'react-jsx',
    '--skipLibCheck', 'true',
    '--types', 'node',
    '--noEmit', 'false',
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-ai-config-store.ts',
  ], { cwd: root, stdio: 'pipe' });
  return behaviorBuildDir;
}

async function importBehaviorModule(relativePath) {
  const buildDir = buildBehaviorModules();
  return import(pathToFileURL(path.join(buildDir, relativePath)).href);
}

function runnableSchedulingResponse() {
  return {
    occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
    aggregateJudgement: {
      state: RUNTIME_SCHEDULING_RUNNABLE,
      detail: '',
      occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
      resourceWarnings: [],
    },
    targetJudgements: [],
  };
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    key(index) {
      return [...map.keys()][index] || null;
    },
    removeItem(key) {
      map.delete(String(key));
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

function installMemoryStorageHarness(t) {
  const previousWindow = globalThis.window;
  const hadLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previousLocalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.window = { localStorage: storage };
  globalThis.localStorage = storage;
  t.after(() => {
    if (typeof previousWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    if (!hadLocalStorage) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  });
}

function protoListValues(value) {
  return value?.kind?.oneofKind === 'listValue' ? value.kind.listValue.values : [];
}

function protoStructFields(value) {
  return value?.kind?.oneofKind === 'structValue' ? value.kind.structValue.fields : {};
}

function protoString(value) {
  return value?.kind?.oneofKind === 'stringValue' ? value.kind.stringValue : '';
}

function protoNumber(value) {
  return value?.kind?.oneofKind === 'numberValue' ? value.kind.numberValue : 0;
}

function readyLocalImageEnvironmentMethods() {
  return {
    async resolveLocalEnvironmentPlan() {
      return {
        plan: {
          planId: 'local-image-native-ready',
          packId: 'local-image-native',
          productLabel: 'Local image native',
          hostProfileId: 'tester-host',
          platformTuple: 'windows-amd64',
          runtimeDataRoot: 'tester-data-root',
          consumerScope: 'local-image-native',
          cloudOnlyImpact: 'none',
          state: 'ready_managed',
          reasonCode: 'LOCAL_ENVIRONMENT_PLAN_READY',
          dependencies: [],
        },
      };
    },
    async listLocalEnvironmentDependencyJobs() {
      return { jobs: [] };
    },
    async startLocalEnvironmentDependencyJob() {
      throw new Error('local image dependency job should not start when environment is ready');
    },
  };
}

function imageGenerationOutput(artifacts) {
  return { output: { oneofKind: 'imageGenerate', imageGenerate: { artifacts } } };
}

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
  store.saveTesterAIConfig({
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
  store.saveTesterAIConfig({
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
  store.saveTesterAIConfig({
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

test('tester surfaces inline runtime media artifact bytes as a previewable data URL', async (t) => {
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
  store.saveTesterAIConfig({
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
  store.saveTesterAIConfig({
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
  store.saveTesterAIConfig({
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
  const jobs = new Map();
  const client = {
    runtime: {
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      artifacts: {
        async readArtifactBytes(request) {
          artifactReads.push(request);
          return {
            bytes: pngBytes,
            mimeType: 'image/png',
            sizeBytes: String(pngBytes.byteLength),
          };
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
