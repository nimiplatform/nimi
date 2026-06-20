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
  const planRequests = [];
  const readyEnvironment = readyLocalImageEnvironmentMethods();
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        ...readyEnvironment,
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
        async resolveLocalEnvironmentPlan(request) {
          planRequests.push(request);
          return readyEnvironment.resolveLocalEnvironmentPlan(request);
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
  assert.deepEqual(planRequests.map((request) => ({
    assetId: request.assetId,
    localAssetId: request.localAssetId,
    companionAssetId: request.companionAssetId,
    parentAssetId: request.parentAssetId,
  })), [
    {
      assetId: 'local-import/z-image-turbo-Q4_K_M',
      localAssetId: 'local-main-image',
      companionAssetId: '',
      parentAssetId: '',
    },
    {
      assetId: 'local-import/z-image-turbo-Q4_K_M',
      localAssetId: 'local-main-image',
      companionAssetId: 'local-import/ae',
      parentAssetId: 'local-import/z-image-turbo-Q4_K_M',
    },
    {
      assetId: 'local-import/z-image-turbo-Q4_K_M',
      localAssetId: 'local-main-image',
      companionAssetId: 'local-import/Qwen3-4B-Q4_K_M',
      parentAssetId: 'local-import/z-image-turbo-Q4_K_M',
    },
  ]);
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

test('image.generate starts local image environment dependencies before submitting generation', async (t) => {
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
      selectedParams: {},
    },
    profileOrigin: null,
  });

  const started = [];
  let generateCalled = false;
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        ...readyLocalImageEnvironmentMethods(),
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [{
              localAssetId: 'local-main-image',
              assetId: 'local-import/z-image-turbo-Q4_K_M',
              kind: 'image',
              engine: 'media',
              status: 'active',
            }],
          };
        },
        async resolveLocalEnvironmentPlan() {
          return {
            plan: {
              planId: 'local-image-native-needs-confirmation',
              packId: 'local-image-native',
              productLabel: 'Local image native',
              hostProfileId: 'tester-host',
              platformTuple: 'windows-amd64',
              runtimeDataRoot: 'tester-data-root',
              consumerScope: 'local-image-native',
              cloudOnlyImpact: 'none',
              state: 'needs_confirmation',
              reasonCode: 'LOCAL_ENVIRONMENT_PLAN_REQUIRES_SETUP',
              dependencies: [{
                dependencyFamily: 'python.tool.uv',
                dependencyId: 'uv',
                consumerScope: 'local-image-native',
                required: true,
                state: 'needs_confirmation',
                sourceKind: 'runtime_managed',
                confirmationRequired: true,
                environmentKey: 'env-python-tool-uv',
                reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED',
                detail: '',
              }],
            },
          };
        },
        async listLocalEnvironmentDependencyJobs() {
          return { jobs: [] };
        },
        async startLocalEnvironmentDependencyJob(request) {
          started.push(request);
          return {
            job: {
              jobId: 'job-python-tool-uv',
              ...request,
              state: 'queued',
              canonicalRoot: '',
              selectedSourceRecordId: '',
              failureDetail: '',
              retryable: true,
              createdAt: '2026-06-18T00:00:00.000Z',
              updatedAt: '2026-06-18T00:00:00.000Z',
              reasonCode: '',
              recoveryDisposition: '',
              bytesReceived: '0',
              bytesTotal: '0',
              percent: 0,
              speedBytesPerSec: '0',
              etaSeconds: '0',
            },
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
          async generate() {
            generateCalled = true;
            throw new Error('image.generate must wait for local image setup readiness');
          },
        },
      },
      ai: {},
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a product panel',
    scenarioId: 'scenario-local-image-setup',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'local-environment-preparing');
  assert.match(result.message, /Runtime local image setup started 1 dependency job/);
  assert.equal(generateCalled, false);
  assert.deepEqual(started, [{
    environmentKey: 'env-python-tool-uv',
    dependencyFamily: 'python.tool.uv',
    dependencyId: 'uv',
    sourceKind: 'runtime_managed',
    confirmed: true,
    consumerScope: 'local-image-native',
  }]);
});

test('image.generate starts concrete companion dependencies instead of waiting on image profile binding blocker', async (t) => {
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
          companionSlots: {
            vae_path: 'local-vae',
            llm_path: 'local-llm',
          },
        },
      },
    },
    profileOrigin: null,
  });

  const started = [];
  let generateCalled = false;
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        ...readyLocalImageEnvironmentMethods(),
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [
              {
                localAssetId: 'local-main-image',
                assetId: 'local-import/z_image_turbo-Q4_K',
                kind: 'image',
                engine: 'media',
                status: 'active',
              },
              {
                localAssetId: 'local-vae',
                assetId: 'local-import/z_image_ae',
                kind: 'vae',
                engine: 'llama',
                status: 'installed',
              },
              {
                localAssetId: 'local-llm',
                assetId: 'local-import/Qwen3-4B-Q4_K_M',
                kind: 'chat',
                engine: 'llama',
                status: 'installed',
              },
            ],
          };
        },
        async resolveLocalEnvironmentPlan(request) {
          const mainAssetDependency = {
            dependencyFamily: 'model.asset',
            dependencyId: 'local-import/z_image_turbo-Q4_K',
            consumerScope: 'stable-diffusion.cpp.cuda',
            required: true,
            state: 'needs_confirmation',
            sourceKind: 'runtime_managed',
            confirmationRequired: true,
            environmentKey: 'env-main-image',
            reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED',
            detail: '',
          };
          if (request.companionAssetId) {
            const dependencyId = `asset_id=${request.companionAssetId}|parent_asset_id=${request.parentAssetId}`;
            return {
              plan: {
                planId: `local-image-native-${request.companionAssetId}`,
                packId: 'local-image-native',
                productLabel: 'Local image native',
                hostProfileId: 'tester-host',
                platformTuple: 'windows-amd64',
                runtimeDataRoot: 'tester-data-root',
                consumerScope: 'stable-diffusion.cpp.cuda',
                cloudOnlyImpact: 'none',
                state: 'needs_confirmation',
                reasonCode: 'LOCAL_ENVIRONMENT_PLAN_REQUIRES_SETUP',
                dependencies: [{
                  dependencyFamily: 'model.companion-asset',
                  dependencyId,
                  consumerScope: 'stable-diffusion.cpp.cuda',
                  required: true,
                  state: 'needs_confirmation',
                  sourceKind: 'runtime_managed',
                  confirmationRequired: true,
                  environmentKey: `env-${request.companionAssetId}`,
                  reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED',
                  detail: '',
                }],
              },
            };
          }
          return {
            plan: {
              planId: 'local-image-native-profile-bindings-required',
              packId: 'local-image-native',
              productLabel: 'Local image native',
              hostProfileId: 'tester-host',
              platformTuple: 'windows-amd64',
              runtimeDataRoot: 'tester-data-root',
              consumerScope: 'stable-diffusion.cpp.cuda',
              cloudOnlyImpact: 'none',
              state: 'unsupported',
              reasonCode: 'LOCAL_ENVIRONMENT_PLAN_UNSUPPORTED',
              dependencies: [
                mainAssetDependency,
                {
                  dependencyFamily: 'model.companion-asset',
                  dependencyId: 'image-profile-bindings:local-main-image',
                  consumerScope: 'stable-diffusion.cpp.cuda',
                  required: true,
                  state: 'unsupported',
                  sourceKind: 'unavailable',
                  confirmationRequired: false,
                  environmentKey: 'env-image-profile-bindings',
                  reasonCode: 'LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED',
                  detail: 'image profile materialization bindings are required before resolving companion assets',
                },
              ],
            },
          };
        },
        async listLocalEnvironmentDependencyJobs() {
          return { jobs: [] };
        },
        async startLocalEnvironmentDependencyJob(request) {
          started.push(request);
          return {
            job: {
              jobId: `job-${started.length}`,
              ...request,
              state: 'queued',
              canonicalRoot: '',
              selectedSourceRecordId: '',
              failureDetail: '',
              retryable: true,
              createdAt: '2026-06-20T00:00:00.000Z',
              updatedAt: '2026-06-20T00:00:00.000Z',
              reasonCode: '',
              recoveryDisposition: '',
              bytesReceived: '0',
              bytesTotal: '0',
              percent: 0,
              speedBytesPerSec: '0',
              etaSeconds: '0',
            },
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
          async generate() {
            generateCalled = true;
            throw new Error('image.generate must wait for local image setup readiness');
          },
        },
      },
      ai: {},
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a cat on a desk',
    scenarioId: 'scenario-local-image-companion-setup',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'local-environment-preparing');
  assert.match(result.message, /Runtime local image setup started 3 dependency job/);
  assert.doesNotMatch(result.message, /image-profile-bindings/);
  assert.equal(generateCalled, false);
  assert.deepEqual(started.map((request) => request.dependencyId), [
    'local-import/z_image_turbo-Q4_K',
    'asset_id=local-import/z_image_ae|parent_asset_id=local-import/z_image_turbo-Q4_K',
    'asset_id=local-import/Qwen3-4B-Q4_K_M|parent_asset_id=local-import/z_image_turbo-Q4_K',
  ]);
});

test('image.generate reports profile binding blocker as missing companion setup when no companions are configured', async (t) => {
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
      selectedParams: {},
    },
    profileOrigin: null,
  });

  const started = [];
  let generateCalled = false;
  const client = {
    runtimeSubjectUserId: 'subject-user-1',
    runtime: {
      local: {
        ...readyLocalImageEnvironmentMethods(),
        async listLocalAssets() {
          return {
            nextPageToken: '',
            assets: [{
              localAssetId: 'local-main-image',
              assetId: 'local-import/z_image_turbo-Q4_K',
              kind: 'image',
              engine: 'media',
              status: 'active',
            }],
          };
        },
        async resolveLocalEnvironmentPlan() {
          return {
            plan: {
              planId: 'local-image-native-profile-bindings-required',
              packId: 'local-image-native',
              productLabel: 'Local image native',
              hostProfileId: 'tester-host',
              platformTuple: 'windows-amd64',
              runtimeDataRoot: 'tester-data-root',
              consumerScope: 'stable-diffusion.cpp.cuda',
              cloudOnlyImpact: 'none',
              state: 'unsupported',
              reasonCode: 'LOCAL_ENVIRONMENT_PLAN_UNSUPPORTED',
              dependencies: [
                {
                  dependencyFamily: 'model.asset',
                  dependencyId: 'local-import/z_image_turbo-Q4_K',
                  consumerScope: 'stable-diffusion.cpp.cuda',
                  required: true,
                  state: 'needs_confirmation',
                  sourceKind: 'runtime_managed',
                  confirmationRequired: true,
                  environmentKey: 'env-main-image',
                  reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED',
                  detail: '',
                },
                {
                  dependencyFamily: 'model.companion-asset',
                  dependencyId: 'image-profile-bindings:local-main-image',
                  consumerScope: 'stable-diffusion.cpp.cuda',
                  required: true,
                  state: 'unsupported',
                  sourceKind: 'unavailable',
                  confirmationRequired: false,
                  environmentKey: 'env-image-profile-bindings',
                  reasonCode: 'LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED',
                  detail: 'image profile materialization bindings are required before resolving companion assets',
                },
              ],
            },
          };
        },
        async listLocalEnvironmentDependencyJobs() {
          return { jobs: [] };
        },
        async startLocalEnvironmentDependencyJob(request) {
          started.push(request);
          return {
            job: {
              jobId: `job-${started.length}`,
              ...request,
              state: 'queued',
              canonicalRoot: '',
              selectedSourceRecordId: '',
              failureDetail: '',
              retryable: true,
              createdAt: '2026-06-20T00:00:00.000Z',
              updatedAt: '2026-06-20T00:00:00.000Z',
              reasonCode: '',
              recoveryDisposition: '',
              bytesReceived: '0',
              bytesTotal: '0',
              percent: 0,
              speedBytesPerSec: '0',
              etaSeconds: '0',
            },
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
          async generate() {
            generateCalled = true;
            throw new Error('image.generate must not run without required companions');
          },
        },
      },
      ai: {},
    },
  };

  const result = await invokers.invokeTesterCapability(client, 'image.generate', {
    prompt: 'a cat on a desk',
    scenarioId: 'scenario-local-image-missing-companions',
    subjectUserId: 'subject-user-1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'local-environment-blocked');
  assert.match(result.message, /requires concrete companion model bindings/);
  assert.match(result.message, /Runtime local image setup started 1 dependency job/);
  assert.equal(generateCalled, false);
  assert.deepEqual(started.map((request) => request.dependencyId), ['local-import/z_image_turbo-Q4_K']);
});
