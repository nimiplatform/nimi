#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

const EXPECTED_EXPORTS = [
  '.', './agent', './ai', './app', './contracts', './features/conversation',
  './features/evaluation', './features/generation', './features/knowledge-context',
  './features/memory-context', './features/toolkits', './features/workflow',
  './realm', './realm/generated', './runtime', './runtime/generated', './testing', './types',
];

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

function assertExportMap() {
  const packageJson = JSON.parse(readFileSync(path.join(vnextRoot, 'package.json'), 'utf8'));
  const actual = Object.keys(packageJson.exports ?? {}).sort();
  const expected = [...EXPECTED_EXPORTS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`vNext public exports changed: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

function writeConsumerFiles() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-public-surface-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  symlinkSync(vnextRoot, path.join(packageDir, 'sdk'), 'dir');
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';

const checks = [
  ['@nimiplatform/sdk', 'createNimiClient'],
  ['@nimiplatform/sdk/runtime', 'createRuntime'],
  ['@nimiplatform/sdk/runtime/generated', 'RuntimeTypedClient'],
  ['@nimiplatform/sdk/realm', 'createRealm'],
  ['@nimiplatform/sdk/realm/generated', 'RealmTypedClient'],
  ['@nimiplatform/sdk/app', 'createNimiAppClient'],
  ['@nimiplatform/sdk/types', 'createNimiError'],
  ['@nimiplatform/sdk/contracts', 'textPart'],
  ['@nimiplatform/sdk/ai', 'createNimiRuntimeAIModel'],
  ['@nimiplatform/sdk/agent', 'runNimiAgent'],
  ['@nimiplatform/sdk/testing', 'createNimiMockModel'],
  ['@nimiplatform/sdk/features/conversation', 'buildNimiConversationHistoryMessages'],
  ['@nimiplatform/sdk/features/knowledge-context', 'createNimiKnowledgeContextBundle'],
  ['@nimiplatform/sdk/features/memory-context', 'buildNimiMemoryContextWindow'],
  ['@nimiplatform/sdk/features/generation', 'createNimiGenerationJob'],
  ['@nimiplatform/sdk/features/workflow', 'createWorldWorkflowPlan'],
  ['@nimiplatform/sdk/features/evaluation', 'createNimiGoldenRun'],
  ['@nimiplatform/sdk/features/toolkits', 'createNimiToolRegistry'],
];

for (const [specifier, exportName] of checks) {
  const module = await import(specifier);
  assert.equal(typeof module[exportName], 'function', specifier + ' must export ' + exportName);
}

const runtimeModule = await import('@nimiplatform/sdk/runtime');
assert.equal('createRuntimeNodeGrpcTransport' in runtimeModule, false);

const typesModule = await import('@nimiplatform/sdk/types');
assert.equal(typesModule.ReasonCode.REALM_UNAVAILABLE, 'REALM_UNAVAILABLE');
assert.equal(typeof typesModule.ReasonCode.RUNTIME_UNAVAILABLE, 'string');
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import { createNimiClient, type NimiClientConfig } from '@nimiplatform/sdk';
import { createRuntime, type CoreTransport } from '@nimiplatform/sdk/runtime';
import { RuntimeTypedClient, ReasonCode as RuntimeGeneratedReasonCode } from '@nimiplatform/sdk/runtime/generated';
import { createRealm, type Realm } from '@nimiplatform/sdk/realm';
import { RealmTypedClient, type RealmModel, type RealmModelName } from '@nimiplatform/sdk/realm/generated';
import { createNimiAppClient, type NimiAppRow } from '@nimiplatform/sdk/app';
import { ReasonCode, createNimiError, type JsonObject, type NimiError } from '@nimiplatform/sdk/types';
import { textPart, type NimiCapabilityManifest, type NimiMessage } from '@nimiplatform/sdk/contracts';
import { collectNimiTextStream, type NimiAiModel } from '@nimiplatform/sdk/ai';
import { runNimiAgent, type NimiAgentSpec } from '@nimiplatform/sdk/agent';
import { createNimiMockModel, userTextMessage } from '@nimiplatform/sdk/testing';
import { buildNimiConversationHistoryWindow } from '@nimiplatform/sdk/features/conversation';
import { createNimiKnowledgeContextBundle } from '@nimiplatform/sdk/features/knowledge-context';
import { buildNimiMemoryContextWindow } from '@nimiplatform/sdk/features/memory-context';
import { createNimiGenerationJob } from '@nimiplatform/sdk/features/generation';
import { createWorldWorkflowPlan } from '@nimiplatform/sdk/features/workflow';
import { createNimiGoldenRun } from '@nimiplatform/sdk/features/evaluation';
import { createNimiToolRegistry } from '@nimiplatform/sdk/features/toolkits';

const transport: CoreTransport = {
  async unary<Response>() { return { status: 3 } as Response; },
  async *serverStream<Response>() { yield { status: 3 } as Response; },
};
const config: NimiClientConfig = { appId: 'dev.nimi.surface', runtime: { transport } };
const client = createNimiClient(config);
const runtime = createRuntime({ transport });
const generatedRuntime = new RuntimeTypedClient(runtime.core as never);
const realm: Realm = createRealm({ transport });
const generatedRealm = new RealmTypedClient(realm.core as never);
const appClient = createNimiAppClient({
  async list(): Promise<readonly NimiAppRow[]> { return []; },
  async get(): Promise<NimiAppRow> {
    return {
      appId: 'dev.nimi.surface',
      appKind: 'nimi-app',
      displayName: 'Surface',
      trustTier: 'nimi-community',
      publisher: 'Nimi',
      aiProfileSelectionRef: 'local-standard',
      capabilitySet: ['text.generate'],
      releaseDescriptorRef: 'release',
      installStoragePolicyRef: 'storage',
      sourceRule: 'test',
    };
  },
  async status() { return { appId: 'dev.nimi.surface', launchReadiness: 'ready' }; },
});
const error: NimiError = createNimiError({ message: 'x', reasonCode: 'SDK_SURFACE', source: 'sdk' });
const json: JsonObject = { reasonCode: ReasonCode.REALM_UNAVAILABLE };
const generatedReason = RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED;
const realmModelName: RealmModelName = 'AbilityDefinitionDto';
const ability: Partial<RealmModel<'AbilityDefinitionDto'>> = { id: 'ability' };
const message: NimiMessage = { role: 'user', content: [textPart('hello')] };
const manifest: NimiCapabilityManifest = {
  adapterId: 'surface',
  targetLibrary: 'surface',
  capabilityLevel: 'L1',
  capabilities: { generate: { support: 'supported', mode: 'adapter-mapped' } },
  unsupportedBehavior: 'throw',
};
const model: NimiAiModel = createNimiMockModel({ text: 'ok' });
const agent: NimiAgentSpec = { id: 'agent', name: 'Agent' };
const plan = createWorldWorkflowPlan({ planId: 'plan', steps: [{ kind: 'world-list' }] });
const registry = createNimiToolRegistry([]);

void client; void runtime; void generatedRuntime; void realm; void generatedRealm; void appClient; void error; void json; void generatedReason; void realmModelName; void ability; void message;
void manifest; void model; void agent; void plan; void registry;
void collectNimiTextStream; void runNimiAgent; void userTextMessage;
void buildNimiConversationHistoryWindow; void createNimiKnowledgeContextBundle;
void buildNimiMemoryContextWindow; void createNimiGenerationJob; void createNimiGoldenRun;
`);
}

function main() {
  assertExportMap();
  run('build sdks/typescript', PNPM_BIN, ['--dir', vnextRoot, 'run', 'build']);
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
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-public-surface-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
