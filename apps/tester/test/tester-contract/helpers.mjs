import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { buildWithTsc } from '../tsc-build.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
} from '../tester-surface-readers.mjs';

export {
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
};

export const root = path.resolve(import.meta.dirname, '../..');

export function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

export function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(next);
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  });
}

let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'behavior-'));
  buildWithTsc([
    '--outDir',
    behaviorBuildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-ai-config-store.ts',
    'src/tester/tester-runtime-model-provider.ts',
    'src/tester/tester-run-target.ts',
    'src/tester/tester-history.ts',
    'src/tester/workbench/section-ai-testing-config-section.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

export async function importBehaviorModule(relativePath) {
  const buildDir = buildBehaviorModules();
  return import(pathToFileURL(path.join(buildDir, relativePath)).href);
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

export const RUNTIME_SCENARIO_TYPE_TEXT_GENERATE = 1;
export const RUNTIME_SCENARIO_TYPE_TEXT_EMBED = 2;
export const RUNTIME_EXECUTION_MODE_SYNC = 1;
export const RUNTIME_EXECUTION_MODE_STREAM = 2;
export const RUNTIME_ROUTE_POLICY_LOCAL = 1;
export const RUNTIME_ROUTE_POLICY_CLOUD = 2;
export const RUNTIME_FINISH_REASON_STOP = 1;
export const RUNTIME_SCHEDULING_RUNNABLE = 1;
export const RUNTIME_SCHEDULING_DENIED = 5;
export const RUNTIME_REASON_CODE_AI_MODEL_NOT_FOUND = 200;

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

export function textGenerateScenarioResponse(input, traceId = 'trace-1', text = 'ok') {
  return {
    output: {
      output: {
        oneofKind: 'textGenerate',
        textGenerate: { text },
      },
    },
    finishReason: RUNTIME_FINISH_REASON_STOP,
    usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
    routeDecision: input.head.routePolicy,
    modelResolved: input.head.modelId,
    traceId,
    ignoredExtensions: [],
  };
}

export function textEmbedScenarioResponse(input, traceId = 'trace-3') {
  return {
    output: {
      output: {
        oneofKind: 'textEmbed',
        textEmbed: {
          vectors: [{ values: [0.1, 0.2] }],
        },
      },
    },
    finishReason: RUNTIME_FINISH_REASON_STOP,
    usage: { inputTokens: '1', outputTokens: '0', computeMs: '0' },
    routeDecision: input.head.routePolicy,
    modelResolved: input.head.modelId,
    traceId,
    ignoredExtensions: [],
  };
}

export async function* textScenarioStream(input, traceId = 'trace-2') {
  yield {
    eventType: 1,
    sequence: '1',
    traceId,
    payload: {
      oneofKind: 'started',
      started: {
        modelResolved: input.head.modelId,
        routeDecision: input.head.routePolicy,
      },
    },
  };
  yield {
    eventType: 2,
    sequence: '2',
    traceId,
    payload: {
      oneofKind: 'delta',
      delta: {
        delta: {
          oneofKind: 'text',
          text: { text: 'o' },
        },
      },
    },
  };
  yield {
    eventType: 5,
    sequence: '3',
    traceId,
    payload: {
      oneofKind: 'usage',
      usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
    },
  };
  yield {
    eventType: 6,
    sequence: '4',
    traceId,
    payload: {
      oneofKind: 'completed',
      completed: {
        finishReason: RUNTIME_FINISH_REASON_STOP,
        usage: { inputTokens: '1', outputTokens: '1', computeMs: '0' },
        streamSimulated: false,
      },
    },
  };
}


export function cleanupBehaviorModules() {
  if (behaviorBuildDir) {
    rmSync(behaviorBuildDir, { recursive: true, force: true });
    behaviorBuildDir = null;
  }
}
