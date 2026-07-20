#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkWorkspacePackage } from './lib/sdk-consumer-link.mjs';
import { isSdkDistPrepared, withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

function cleanup() {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-ai-consumer-smoke] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status ?? 1)}`);
  }
}

function writeConsumerFiles() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-ai-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAppAIScopeRef,
  createNimiAIScopeRef,
  createNimiAISnapshotRecord,
  createNimiAISnapshotStore,
  createNimiRuntimeAISchedulingClient,
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  collectNimiTextStream,
  ensureNimiAppFirstLaunchAIConfig,
  parseNimiAccountProfileLibraryProjection,
  versionNimiAIConfig,
} from '@nimiplatform/sdk/ai';

const values = new Map();
const storage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); },
};

const scopeRef = createNimiAIScopeRef({ kind: 'app', ownerId: 'dev.nimi.consumer', surfaceId: 'chat' });
function requirementDeclarations(ref) {
  return [{
    requirementId: ref.surfaceId ? ref.ownerId + '.' + ref.surfaceId + '.requirements' : ref.ownerId + '.requirements',
    scopeRef: ref,
    requiredSlices: [{
      requirementSliceId: 'chat.text.generate',
      capability: 'text.generate',
      profileSliceRef: 'capabilities.text.generate',
      readinessPolicy: 'required',
    }],
    setupProjectionPolicy: 'setup-required',
  }];
}
const profile = {
  profileId: 'profile-chat',
  title: 'Consumer profile',
  capabilities: {
    'text.generate': {
      targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'target-chat' },
      runtimeDescriptor: {
        executionMode: 'local',
        execution: { backend: 'llama.cpp' },
        model: { family: 'llama' },
      },
    },
  },
};
const configStore = createNimiAIConfigStore({ storage: () => storage });
const snapshotStore = createNimiAISnapshotStore({ storage: () => storage });
const surface = createNimiAIHostSurface({
  profiles: [profile],
  configStore,
  snapshotStore,
  now: () => '2026-06-04T00:00:00.000Z',
});

const requirements = requirementDeclarations(scopeRef);
const preview = await surface.aiProfile.previewApply(scopeRef, 'profile-chat', {
  requirementDeclarations: requirements,
});
assert.equal(preview.outcome, 'ready_to_apply');
assert.equal(configStore.has(scopeRef), false);

const applied = await surface.aiProfile.apply(scopeRef, 'profile-chat', {
  requirementDeclarations: requirements,
  expectedBaseVersion: preview.baseVersion,
});
assert.equal(applied.success, true);
assert.equal(surface.aiConfig.get(scopeRef).profileOrigin.profileId, 'profile-chat');

const snapshot = createNimiAISnapshotRecord({
  executionId: 'exec-consumer',
  scopeRef,
  config: surface.aiConfig.get(scopeRef),
  capability: 'text.generate',
  selectedTargetRef: surface.aiConfig.get(scopeRef).capabilities.targetRefs['text.generate'],
  createdAt: '2026-06-04T00:00:01.000Z',
});
surface.aiSnapshot.record(scopeRef, snapshot);
assert.equal(surface.aiSnapshot.getLatest(scopeRef).configEvidence.configHash, versionNimiAIConfig(surface.aiConfig.get(scopeRef)));

const runtimeCalls = [];
const runtimeModel = createNimiRuntimeAIModel({
  appId: 'consumer-app',
  model: { modelId: 'runtime-model' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'runtime-model' },
  runtime: {
    async executeScenario(request) {
      runtimeCalls.push(request);
      return {
        output: { output: { oneofKind: 'textGenerate', textGenerate: { text: 'runtime text' } } },
        finishReason: 1,
        usage: { inputTokens: '2', outputTokens: '3', computeMs: '4' },
        routeDecision: 1,
        modelResolved: 'runtime-model',
        traceId: 'trace-runtime',
        ignoredExtensions: [],
      };
    },
    async *streamScenario(request) {
      runtimeCalls.push(request);
      yield { eventType: 1, sequence: '1', traceId: 'trace-stream', payload: { oneofKind: 'started', started: { modelResolved: 'runtime-model', routeDecision: 1 } } };
      yield { eventType: 2, sequence: '2', traceId: 'trace-stream', payload: { oneofKind: 'delta', delta: { delta: { oneofKind: 'text', text: { text: 'stream text' } } } } };
      yield { eventType: 6, sequence: '3', traceId: 'trace-stream', payload: { oneofKind: 'completed', completed: { finishReason: 1, usage: { inputTokens: '1', outputTokens: '2', computeMs: '3' }, streamSimulated: false } } };
    },
  },
});
const generated = await runtimeModel.generateText({
  model: runtimeModel.model,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
});
assert.equal(generated.text, 'runtime text');
const streamed = await collectNimiTextStream(await runtimeModel.streamText({
  model: runtimeModel.model,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
}));
assert.equal(streamed.text, 'stream text');
assert.equal(runtimeCalls[0].scenarioType, 1);
assert.equal(runtimeCalls[0].head.fallback, 1);

const embeddingCalls = [];
const embedding = createNimiRuntimeEmbeddingClient({
  appId: 'consumer-app',
  model: { providerId: 'runtime', modelId: 'embedder' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'embedder' },
  runtime: {
    async executeScenario(request) {
      embeddingCalls.push(request);
      return {
        output: { output: { oneofKind: 'textEmbed', textEmbed: { vectors: [{ values: [0.1, 0.2] }] } } },
        finishReason: 1,
        usage: { inputTokens: '1', outputTokens: '0', computeMs: '2' },
        routeDecision: 1,
        modelResolved: 'embedder',
        traceId: 'trace-embed',
        ignoredExtensions: [],
      };
    },
  },
});
const embedded = await embedding.embedText({ values: ['consumer query'] });
assert.equal(embeddingCalls[0].scenarioType, 2);
assert.deepEqual(embedded.embeddings, [[0.1, 0.2]]);
assert.equal(embedded.usage.totalTokens, 1);

const schedulingCalls = [];
const scheduling = createNimiRuntimeAISchedulingClient({
  appId: 'consumer-app',
  config: surface.aiConfig.get(scopeRef),
  runtime: {
    async peekScheduling(request) {
      schedulingCalls.push(request);
      return {
        occupancy: { globalUsed: 1, globalCap: 4, appUsed: 1, appCap: 2 },
        aggregateJudgement: { state: 1, detail: 'ready', resourceWarnings: [] },
        targetJudgements: [{
          target: request.targets[0],
          judgement: { state: 1, detail: 'target ready', resourceWarnings: [] },
        }],
      };
    },
  },
});
const schedulingProjection = await scheduling.peek();
assert.equal(schedulingCalls[0].targets[0].targetId, 'target-chat');
assert.equal(schedulingProjection.aggregateJudgement.state, 'runnable');

const firstLaunchScope = createNimiAppAIScopeRef('dev.nimi.consumer.first-launch', 'chat');
let firstLaunchStored = null;
const firstLaunch = await ensureNimiAppFirstLaunchAIConfig({
  scopeRef: firstLaunchScope,
  getExistingAppAIConfig: () => firstLaunchStored,
  resolveRecommendedProfile: () => ({ profile, manifestSatisfied: true }),
  resolveAccountDefaultProfile: () => null,
  resolveRequirementDeclarations: () => requirementDeclarations(firstLaunchScope),
  applyHostAIConfig: (_scopeRef, config) => {
    firstLaunchStored = config;
    return config;
  },
  validateManifestRequirements: () => [],
  now: () => '2026-06-04T00:00:02.000Z',
});
assert.equal(firstLaunch.outcome, 'initialized');
assert.equal(firstLaunchStored.profileOrigin.profileId, 'profile-chat');

const library = parseNimiAccountProfileLibraryProjection({
  accountId: 'acct-consumer',
  libraryRef: 'profile-library:acct-consumer',
  index: {
    schemaVersion: 1,
    accountId: 'acct-consumer',
    updatedAt: '2026-06-04T00:00:00.000Z',
    entries: [{
      profileId: 'profile-chat',
      title: 'Consumer profile',
      origin: 'user',
      relativePath: 'profiles/profile-chat.json',
      editable: true,
      removable: true,
      updatedAt: '2026-06-04T00:00:00.000Z',
    }],
  },
  profiles: [{
    profileId: 'profile-chat',
    origin: 'user',
    editable: true,
    removable: true,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    profile,
  }],
});
assert.equal(library.profiles[0].profile.profileId, 'profile-chat');

await assert.rejects(
  import('@nimiplatform/sdk/ai-app'),
  /Package subpath '.\\/ai-app' is not defined/,
);
await assert.rejects(
  import('@nimiplatform/sdk/ai-provider'),
  /Package subpath '.\\/ai-provider' is not defined/,
);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAppAIScopeRef,
  createNimiAIScopeRef,
  createNimiRuntimeAISchedulingClient,
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
	  ensureNimiAppFirstLaunchAIConfig,
	  type NimiAICapabilityRequirementDeclaration,
	  type NimiAIConfig,
	  type NimiAIProfile,
	  type NimiAIScopeRef,
  type NimiRuntimeEmbeddingSurface,
  type NimiRuntimeAISchedulingProjectionClient,
  type NimiRuntimeAIScenarioClient,
} from '@nimiplatform/sdk/ai';

const scopeRef = createNimiAIScopeRef({ kind: 'app', ownerId: 'dev.nimi.typed' });
function requirementDeclarations(ref: NimiAIScopeRef): readonly NimiAICapabilityRequirementDeclaration[] {
  return [{
    requirementId: 'typed.requirements',
    scopeRef: ref,
    requiredSlices: [{
      requirementSliceId: 'typed.text.generate',
      capability: 'text.generate',
      profileSliceRef: 'capabilities.text.generate',
      readinessPolicy: 'required',
    }],
    setupProjectionPolicy: 'setup-required',
  }];
}
const profile: NimiAIProfile = {
  profileId: 'profile',
  title: 'Typed profile',
  capabilities: {
    'text.generate': {
      targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'runtime-profile' },
    },
  },
};
const surface = createNimiAIHostSurface({
  profiles: [profile],
  configStore: createNimiAIConfigStore({ enableEphemeralStore: true }),
});
const config: NimiAIConfig = surface.aiConfig.get(scopeRef);
const runtime: NimiRuntimeAIScenarioClient = {
  async executeScenario() {
    throw new Error('typed only');
  },
  async *streamScenario() {
    throw new Error('typed only');
  },
};
const model = createNimiRuntimeAIModel({
  appId: 'typed-app',
  model: { modelId: 'runtime-model' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'runtime-model' },
  runtime,
});
const embedding: NimiRuntimeEmbeddingSurface = createNimiRuntimeEmbeddingClient({
  appId: 'typed-app',
  model: { modelId: 'embedding-model' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'embedding-model' },
  runtime: {
    async executeScenario() {
      throw new Error('typed only');
    },
  },
});
const scheduling: NimiRuntimeAISchedulingProjectionClient = createNimiRuntimeAISchedulingClient({
  appId: 'typed-app',
  targets: [{ capability: 'text.generate', targetId: 'runtime-target', profileId: 'runtime-profile' }],
  runtime: {
    async peekScheduling() {
      throw new Error('typed only');
    },
  },
});
const firstLaunch = ensureNimiAppFirstLaunchAIConfig({
  scopeRef: createNimiAppAIScopeRef('typed-app', 'chat'),
  getExistingAppAIConfig: () => null,
  resolveRecommendedProfile: () => ({ profile, manifestSatisfied: true }),
  resolveAccountDefaultProfile: () => null,
  resolveRequirementDeclarations: ({ scopeRef: firstLaunchScope }) => requirementDeclarations(firstLaunchScope),
  applyHostAIConfig: (_scopeRef, nextConfig) => nextConfig,
});
void config;
void model;
void embedding;
void scheduling;
void firstLaunch;
`);

  writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['consumer.ts'],
  }, null, 2));
}

function main() {
  if (!isSdkDistPrepared()) {
    run('building sdks/typescript package', PNPM_BIN, ['--dir', vnextRoot, 'build']);
  }
  writeConsumerFiles();
  run('running package export consumer', 'node', [path.join(tempRoot, 'consumer.mjs')], { cwd: tempRoot });
  run('typechecking package export consumer', PNPM_BIN, [
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '-p',
    path.join(tempRoot, 'tsconfig.json'),
  ]);
  process.stdout.write('SDK vNext AI consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-ai-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-ai-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
