import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

export const root = path.resolve(import.meta.dirname, '..');
export const RUNTIME_SCENARIO_TYPE_IMAGE_GENERATE = 3;
export const RUNTIME_SCENARIO_TYPE_SPEECH_SYNTHESIZE = 5;
export const RUNTIME_SCENARIO_TYPE_SPEECH_TRANSCRIBE = 6;
export const RUNTIME_EXECUTION_MODE_ASYNC_JOB = 3;
export const RUNTIME_ROUTE_POLICY_LOCAL = 1;
export const RUNTIME_SCENARIO_JOB_STATUS_COMPLETED = 4;
export const RUNTIME_SCHEDULING_RUNNABLE = 1;
export const RUNTIME_VOICE_ASSET_STATUS_ACTIVE = 1;

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

export async function importBehaviorModule(relativePath) {
  const buildDir = buildBehaviorModules();
  return import(pathToFileURL(path.join(buildDir, relativePath)).href);
}

export function runnableSchedulingResponse() {
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

export function createMemoryStorage(initial = {}) {
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

export function installMemoryStorageHarness(t) {
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

export function protoListValues(value) {
  return value?.kind?.oneofKind === 'listValue' ? value.kind.listValue.values : [];
}

export function protoStructFields(value) {
  return value?.kind?.oneofKind === 'structValue' ? value.kind.structValue.fields : {};
}

export function protoString(value) {
  return value?.kind?.oneofKind === 'stringValue' ? value.kind.stringValue : '';
}

export function protoNumber(value) {
  return value?.kind?.oneofKind === 'numberValue' ? value.kind.numberValue : 0;
}

export function readyLocalImageEnvironmentMethods() {
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

export function imageGenerationOutput(artifacts) {
  return { output: { oneofKind: 'imageGenerate', imageGenerate: { artifacts } } };
}
