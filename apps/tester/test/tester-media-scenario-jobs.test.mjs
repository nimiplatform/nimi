import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
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

test('tester media lanes dispatch through Runtime Scenario jobs when vNext media facade is absent', async (t) => {
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
          targetId: 'core:runtime',
          profileId: 'local.image.scenario',
        },
        'audio.synthesize': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local.tts.scenario',
        },
        'audio.transcribe': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local.stt.scenario',
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
          voiceRef: 'provider_voice_ref:aiden',
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
            return {
              traceId: job.traceId,
              artifacts: [{ artifactId: 'img-art', mimeType: 'image/png', uri: '', bytes: new Uint8Array([1, 2, 3]) }],
              output: { output: { oneofKind: undefined } },
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
  assert.deepEqual(submitted.map((request) => request.spec.spec.oneofKind), [
    'imageGenerate',
    'speechSynthesize',
    'speechTranscribe',
  ]);
  assert.equal(submitted[0].extensions[0]?.namespace, 'nimi.scenario.image.request');
  assert.equal(
    submitted[1].spec.spec.speechSynthesize.voiceRef.reference.providerVoiceRef,
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

test('image.generate materializes local model and companion slots into Runtime profile entries', async (t) => {
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
          targetId: 'media',
          profileId: 'local-main-image',
        },
      },
      selectedParams: {
        'image.generate': {
          steps: '15',
          companionSlots: {
            vae_path: 'local-vae',
            llm_path: 'local-llm',
          },
        },
      },
    },
    profileOrigin: null,
  });

  const calls = [];
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [
              {
                localAssetId: 'local-main-image',
                assetId: 'local-import/z-image-turbo-Q4_K_M',
                kind: 'image',
                engine: 'media',
                status: 'active',
              },
              {
                localAssetId: 'local-vae',
                assetId: 'local-import/ae',
                kind: 'vae',
                engine: 'llama',
                status: 'installed',
              },
              {
                localAssetId: 'local-llm',
                assetId: 'local-import/Qwen3-4B-Q4_K_M',
                kind: 'chat',
                engine: 'llama',
                status: 'active',
              },
            ],
          };
        },
      },
      scheduling: {
        async peekScheduling() {
          return runnableSchedulingResponse();
        },
      },
      media: {
        image: {
          async generate(request) {
            calls.push(request);
            return {
              job: { jobId: 'job-image', status: RUNTIME_SCENARIO_JOB_STATUS_COMPLETED },
              artifacts: [],
              trace: { modelResolved: request.model, routeDecision: request.route },
            };
          },
        },
      },
      ai: {},
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a product panel',
    scenarioId: 'scenario-local-image-profile',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'local');
  assert.equal(calls[0].model, 'local-import/z-image-turbo-Q4_K_M');
  const payload = calls[0].extensions[0]?.payload;
  const fields = payload?.fields ?? {};
  const profileEntries = protoListValues(fields.profile_entries);
  assert.equal(profileEntries.length, 3);
  const entryObjects = profileEntries.map(protoStructFields);
  assert.deepEqual(entryObjects.map((entry) => protoString(entry.entry_id)), [
    'main-image',
    'companion-vae',
    'companion-llm',
  ]);
  assert.deepEqual(entryObjects.map((entry) => protoString(entry.asset_id)), [
    'local-import/z-image-turbo-Q4_K_M',
    'local-import/ae',
    'local-import/Qwen3-4B-Q4_K_M',
  ]);
  assert.deepEqual(entryObjects.map((entry) => protoString(entry.engine_slot)), [
    '',
    'vae_path',
    'llm_path',
  ]);
  const entryOverrides = protoListValues(fields.entry_overrides);
  assert.deepEqual(entryOverrides.map((entry) => protoString(protoStructFields(entry).local_asset_id)), [
    'local-main-image',
    'local-vae',
    'local-llm',
  ]);
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
          targetId: 'core:runtime',
          profileId: 'local.image.test',
        },
        'audio.synthesize': {
          kind: 'local-runtime',
          targetId: 'core:runtime',
          profileId: 'local.tts.test',
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
      },
    },
    profileOrigin: null,
  });

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
  const ttsRequests = [];
  const client = {
    runtime: {
      local: {
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
          throw new Error('executeScenario should not be called by this media facade compatibility test');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called by this media facade compatibility test');
        },
      },
      media: {
        image: {
          async generate() {
            return {
              job: { jobId: 'img-job-1', state: 'completed' },
              artifacts: [{ artifactId: 'art-img', mimeType: 'image/png', uri: '', bytes: pngBytes }],
              trace: { traceId: 'img-trace', modelResolved: 'local/z-image', routeDecision: 'local' },
            };
          },
        },
        tts: {
          async synthesize(request) {
            ttsRequests.push(request);
            return {
              job: { jobId: 'tts-job-1', state: 'completed' },
              artifacts: [{ artifactId: 'art-tts', mimeType: 'audio/wav', uri: '', bytes: wavBytes }],
              trace: { traceId: 'tts-trace', modelResolved: 'local/piper', routeDecision: 'local' },
            };
          },
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
  assert.equal(ttsRequests[0]?.model, 'speech/qwen3-tts-test');
  assert.equal(ttsResult.output.kind, 'artifacts');
  const ttsUrl = ttsResult.output.firstArtifact?.url ?? '';
  assert.match(ttsUrl, /^data:audio\/wav;base64,/);
  assert.deepEqual(new Uint8Array(Buffer.from(ttsUrl.split(',')[1], 'base64')), wavBytes);
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
          providerModelId: 'cloud.image.test',
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
          throw new Error('executeScenario should not be called by this media facade compatibility test');
        },
        streamScenario() {
          throw new Error('streamScenario should not be called by this media facade compatibility test');
        },
      },
      media: {
        image: {
          async generate() {
            return {
              job: { jobId: 'img-job-2', state: 'completed' },
              artifacts: [{
                artifactId: 'art-hosted',
                mimeType: 'image/png',
                uri: 'https://cdn.example/img.png',
                bytes: new Uint8Array([1, 2, 3]),
              }],
              trace: { traceId: 'img-trace-2', modelResolved: 'cloud/x', routeDecision: 'cloud' },
            };
          },
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
          providerModelId: 'cloud.image.test',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22, 0x33, 0x44]);
  const artifactReads = [];
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
      },
      media: {
        image: {
          async generate() {
            return {
              job: { jobId: 'img-job-compact', state: 'completed' },
              artifacts: [{ artifactId: 'art-compact-img', mimeType: 'image/png', uri: '', bytes: new Uint8Array() }],
              trace: { traceId: 'img-compact-trace', modelResolved: 'cloud/x', routeDecision: 'cloud' },
            };
          },
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
