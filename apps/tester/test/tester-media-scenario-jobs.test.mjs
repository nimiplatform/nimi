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

test('tester media lanes dispatch through Runtime Scenario jobs when vNext media facade is absent', async () => {
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
        },
      },
    },
    profileOrigin: null,
  });

  const submitted = [];
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
    'local.tts.scenario',
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
