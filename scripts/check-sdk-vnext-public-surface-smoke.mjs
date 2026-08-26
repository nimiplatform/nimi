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
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-public-surface-smoke] ${label}\n`);
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
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-public-surface-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';

const checks = [
  ['@nimiplatform/sdk', 'createNimiClient'],
  ['@nimiplatform/sdk/runtime', 'createRuntime'],
  ['@nimiplatform/sdk/realm', 'createRealm'],
  ['@nimiplatform/sdk/app', 'createNimiAppClient'],
  ['@nimiplatform/sdk/types', 'createNimiError'],
  ['@nimiplatform/sdk/contracts', 'textPart'],
  ['@nimiplatform/sdk/ai', 'createNimiRuntimeAIModel'],
  ['@nimiplatform/sdk/ai-runner', 'runNimiAiRunner'],
  ['@nimiplatform/sdk/testing', 'createNimiMockModel'],
  ['@nimiplatform/sdk/features/conversation', 'buildNimiConversationHistoryMessages'],
  ['@nimiplatform/sdk/features/knowledge-context', 'createNimiKnowledgeContextBundle'],
  ['@nimiplatform/sdk/features/memory-context', 'buildNimiMemoryContextWindow'],
  ['@nimiplatform/sdk/features/generation', 'createNimiGenerationJob'],
  ['@nimiplatform/sdk/features/evaluation', 'createNimiGoldenRun'],
  ['@nimiplatform/sdk/features/toolkits', 'createNimiToolRegistry'],
];

for (const [specifier, exportName] of checks) {
  const module = await import(specifier);
  assert.equal(typeof module[exportName], 'function', specifier + ' must export ' + exportName);
}

const realmGeneratedModule = await import('@nimiplatform/sdk/realm/generated');
assert.equal('RealmTypedClient' in realmGeneratedModule, false);
assert.equal('SourceMaterializationPacketV3Dto' in realmGeneratedModule, false);

const runtimeWireTypesModule = await import('@nimiplatform/sdk/runtime/wire-types');
assert.equal(runtimeWireTypesModule.ScenarioType.TEXT_GENERATE, 1);
assert.equal(runtimeWireTypesModule.AccountSessionState.AUTHENTICATED, 3);

const runtimeModule = await import('@nimiplatform/sdk/runtime');
assert.equal('createRuntimeNodeGrpcTransport' in runtimeModule, false);
assert.equal('createNimiRuntimeInstalledAppSessionMetadataProvider' in runtimeModule, false);
assert.equal('createNimiDesktopLaunchedNimiAppRuntimeAccountCaller' in runtimeModule, false);

const appModule = await import('@nimiplatform/sdk/app');
assert.equal('createNimiAppRuntimePlatformClient' in appModule, false);
assert.equal('createInstalledNimiAppBootstrap' in appModule, false);

const typesModule = await import('@nimiplatform/sdk/types');
assert.equal(typesModule.ReasonCode.REALM_UNAVAILABLE, 'REALM_UNAVAILABLE');
assert.equal(typeof typesModule.ReasonCode.RUNTIME_UNAVAILABLE, 'string');
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import { createNimiClient, type NimiClientConfig, type NimiLocalAppStandardShell } from '@nimiplatform/sdk';
import { createRuntime, type CoreTransport } from '@nimiplatform/sdk/runtime';
import { ReasonCode as RuntimeGeneratedReasonCode } from '@nimiplatform/sdk/runtime/generated';
import { ScenarioType, type ExecuteScenarioRequest } from '@nimiplatform/sdk/runtime/wire-types';
import { createRealm, type Realm } from '@nimiplatform/sdk/realm';
import { type RealmModel, type RealmModelName } from '@nimiplatform/sdk/realm/generated';
import {
  createNimiAppClient,
  type NimiAppInventoryEntry,
} from '@nimiplatform/sdk/app';
import { ReasonCode, createNimiError, type JsonObject, type NimiError } from '@nimiplatform/sdk/types';
import { textPart, type NimiCapabilityManifest, type NimiMessage } from '@nimiplatform/sdk/contracts';
import { collectNimiTextStream, type NimiAiModel } from '@nimiplatform/sdk/ai';
import { runNimiAiRunner, type NimiAiRunnerSpec } from '@nimiplatform/sdk/ai-runner';
import { createNimiMockModel, userTextMessage } from '@nimiplatform/sdk/testing';
import { buildNimiConversationHistoryWindow } from '@nimiplatform/sdk/features/conversation';
import { createNimiKnowledgeContextBundle } from '@nimiplatform/sdk/features/knowledge-context';
import { buildNimiMemoryContextWindow } from '@nimiplatform/sdk/features/memory-context';
import { createNimiGenerationJob } from '@nimiplatform/sdk/features/generation';
import { createNimiGoldenRun } from '@nimiplatform/sdk/features/evaluation';
import { createNimiToolRegistry } from '@nimiplatform/sdk/features/toolkits';

const transport: CoreTransport = {
  async unary<Response>() { return { status: 3 } as Response; },
  async *serverStream<Response>() { yield { status: 3 } as Response; },
};
const config: NimiClientConfig = { appId: 'dev.nimi.surface', runtime: { transport } };
const client = createNimiClient(config);
const runtime = createRuntime({ transport });
const realm: Realm = createRealm({ transport });
const appEntry: NimiAppInventoryEntry = {
  appId: 'dev.nimi.surface',
  displayName: 'Surface',
  trustClass: 'local_development',
  source: {
    status: 'present',
    value: {
      appId: 'dev.nimi.surface',
      displayName: 'Surface',
      trustClass: 'local_development',
      recordState: 'active',
      sessionState: 'session-bound',
    },
  },
  localRecordState: 'active',
  openReadiness: 'ready',
  nextActions: ['open'],
};
const appClient = createNimiAppClient({
  async list(): Promise<readonly NimiAppInventoryEntry[]> { return [appEntry]; },
  async get(): Promise<NimiAppInventoryEntry> { return appEntry; },
  async status() { return { appId: 'dev.nimi.surface', launchReadiness: 'ready' }; },
});
const unavailableCarrier = async (): Promise<never> => {
  throw new Error('public surface smoke carrier is not executable');
};
const localAppStandardShell: NimiLocalAppStandardShell = {
  session: { async status() { return { state: 'ready', reasonCode: 'ACTION_EXECUTED', retryable: false }; } },
  ai: {
    text: {
      async generateCandidate() { return {}; },
      streamTurn: unavailableCarrier,
    },
    scenario: { execute: unavailableCarrier },
    scenarioJobs: {
      submit: unavailableCarrier,
      get: unavailableCarrier,
      subscribe: unavailableCarrier,
      cancel: unavailableCarrier,
    },
    artifacts: { read: unavailableCarrier, upload: unavailableCarrier },
    voiceAssets: { list: unavailableCarrier },
    realtime: {
      open: unavailableCarrier,
      appendInput: unavailableCarrier,
      submitOwnerControl: unavailableCarrier,
      subscribe: unavailableCarrier,
      interruptOutput: unavailableCarrier,
      close: unavailableCarrier,
    },
  },
  aiConfig: {
    async get() { return {}; },
    overwrite: unavailableCarrier,
    listOptions: unavailableCarrier,
  },
  storage: {
    async readJson() { return {}; },
    async writeJson() { return {}; },
    async removeJson() { return {}; },
    assets: {
      stat: unavailableCarrier,
      list: unavailableCarrier,
      write: unavailableCarrier,
      read: unavailableCarrier,
      remove: unavailableCarrier,
      move: unavailableCarrier,
      adoptArtifact: unavailableCarrier,
      reveal: unavailableCarrier,
    },
  },
  realm: {
    chat: { list: unavailableCarrier },
    worldCore: {
      async list() { return []; },
      async create() { return {}; },
    },
    personaCharacter: {
      async listOwned() { return []; },
      async getOwned() { return {}; },
      async create() { return {}; },
      async replace() { return {}; },
      async delete() { return {}; },
    },
    realtime: {
      open: unavailableCarrier,
      subscribe: unavailableCarrier,
      ack: unavailableCarrier,
      closeSubscription: unavailableCarrier,
      closeChannel: unavailableCarrier,
    },
  },
  agents: {
    async listReferences() { return []; },
  },
  conversation: {
    async open() { return { conversationAnchorId: 'anchor-1', activeTurnId: null }; },
    async send() { return { turnId: 'turn-1' }; },
    uploadAttachment: unavailableCarrier,
    readArtifact: unavailableCarrier,
    transcribeVoice: unavailableCarrier,
    async interruptTurn() { return { turnId: 'turn-1' }; },
    async subscribe() {
      return {
        events: { async *[Symbol.asyncIterator]() {} },
        async cancel() { return undefined; },
      };
    },
    async snapshot() { return {}; },
  },
  agentRealtime: {
    open: unavailableCarrier,
    appendInput: unavailableCarrier,
    subscribe: unavailableCarrier,
    status: unavailableCarrier,
    interruptOutput: unavailableCarrier,
    close: unavailableCarrier,
  },
  agentConfigure: {
    sharedAIConfig: { get: unavailableCarrier, overwrite: unavailableCarrier, listOptions: unavailableCarrier },
    autonomy: { snapshot: unavailableCarrier, update: unavailableCarrier },
    presentation: { snapshot: unavailableCarrier, commit: unavailableCarrier },
  },
};
const localApp = createNimiClient({ localApp: { standardShell: localAppStandardShell } });
const error: NimiError = createNimiError({ message: 'x', reasonCode: 'SDK_SURFACE', source: 'sdk' });
const json: JsonObject = { reasonCode: ReasonCode.REALM_UNAVAILABLE };
const generatedReason = RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED;
const scenarioRequest: Partial<ExecuteScenarioRequest> = { scenarioType: ScenarioType.TEXT_GENERATE };
const realmModelName: RealmModelName = 'PostDto';
const post: Partial<RealmModel<'PostDto'>> = {};
// @ts-expect-error Packet transport models are Runtime-internal authority.
const packetModelName: RealmModelName = 'SourceMaterializationPacketV3Dto';
// @ts-expect-error Realm grant transport models are Runtime-internal authority.
const grantModelName: RealmModelName = 'AppPermissionGrantDto';
// @ts-expect-error Raw Realm source refs are not exposed through the Realm facade model barrel.
const sourceRefModelName: RealmModelName = 'CharacterSourceRefV3Dto';
const message: NimiMessage = { role: 'user', content: [textPart('hello')] };
const manifest: NimiCapabilityManifest = {
  adapterId: 'surface',
  targetLibrary: 'surface',
  capabilityLevel: 'L1',
  capabilities: { generate: { support: 'supported', mode: 'adapter-mapped' } },
  unsupportedBehavior: 'throw',
};
const model: NimiAiModel = createNimiMockModel({ text: 'ok' });
const runner: NimiAiRunnerSpec = { id: 'runner', name: 'Runner' };
const registry = createNimiToolRegistry([]);

void client; void runtime; void realm; void appClient; void localApp; void error; void json; void generatedReason; void scenarioRequest; void realmModelName; void post; void packetModelName; void grantModelName; void sourceRefModelName; void message;
void manifest; void model; void runner; void registry;
void collectNimiTextStream; void runNimiAiRunner; void userTextMessage;
void buildNimiConversationHistoryWindow; void createNimiKnowledgeContextBundle;
void buildNimiMemoryContextWindow; void createNimiGenerationJob; void createNimiGoldenRun;
`);
}

function main() {
  if (!isSdkDistPrepared()) {
    run('build sdks/typescript', PNPM_BIN, ['--dir', vnextRoot, 'run', 'build']);
  }
  writeConsumerFiles();
  run('execute public surface consumer', 'node', [path.join(tempRoot, 'consumer.mjs')]);
  run('typecheck public surface declarations', PNPM_BIN, [
    '--dir', vnextRoot, 'exec', 'tsc',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--strict',
    '--skipLibCheck',
    '--noEmit',
    path.join(tempRoot, 'consumer.ts'),
  ]);
  process.stdout.write('SDK vNext public surface smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-public-surface-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-public-surface-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
