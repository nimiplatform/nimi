import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AccountCallerMode,
  AccountSessionState,
  ChatContentPartType,
  ConnectorKind,
  ConnectorStatus,
  ExecutionMode,
  FallbackPolicy,
  FinishReason,
  LocalAssetKind,
  LocalAssetStatus,
  RoutePolicy,
  ScenarioType,
} from './index';
import type {
  AccountProjection,
  ChatContentPart,
  ChatMessage,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  ScenarioArtifact,
} from './index';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readPackageFile(relativePath: string): string {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}

function assertWireTypesBoundary(relativePath: string): void {
  const source = readPackageFile(relativePath);
  assert.equal(
    /runtime\/generated/.test(source),
    false,
    `${relativePath} must not import the monolithic runtime/generated barrel`,
  );
  assert.equal(
    /runtime-typed-client/.test(source),
    false,
    `${relativePath} must not import RuntimeTypedClient`,
  );
  const generatedRuntimeValueImports = source
    .split(/\r?\n/)
    .filter((line) => /from ['"]\.\.\/\.\.\/core-generated\/runtime-protobuf\/runtime\/v1\//.test(line))
    .filter((line) => !/^\s*export\s+type\s/.test(line));
  assert.deepEqual(
    generatedRuntimeValueImports,
    [],
    `${relativePath} must not value-import runtime protobuf modules`,
  );
}

test('runtime wire-types exposes ParentOS-needed enum values without importing generated runtime values', () => {
  assert.equal(AccountSessionState.AUTHENTICATED, 3);
  assert.equal(AccountSessionState[3], 'AUTHENTICATED');
  assert.equal(AccountCallerMode.LOCAL_DEVELOPER_APP, 7);
  assert.equal(AccountCallerMode[7], 'LOCAL_DEVELOPER_APP');
  assert.equal(ChatContentPartType.TEXT, 1);
  assert.equal(ExecutionMode.STREAM, 2);
  assert.equal(FallbackPolicy.DENY, 1);
  assert.equal(FinishReason.TOOL_CALL, 3);
  assert.equal(RoutePolicy.CLOUD, 2);
  assert.equal(ScenarioType.TEXT_GENERATE, 1);
  assert.equal(ScenarioType[1], 'TEXT_GENERATE');
  assert.equal(ConnectorKind.REMOTE_MANAGED, 2);
  assert.equal(ConnectorStatus.ACTIVE, 1);
  assert.equal(LocalAssetKind.CHAT, 1);
  assert.equal(LocalAssetStatus.ACTIVE, 2);

  const projection = {
    accountId: 'acct-1',
  } satisfies Partial<AccountProjection>;
  const part = {
    type: ChatContentPartType.TEXT,
    content: { oneofKind: 'text', text: 'hello' },
  } satisfies ChatContentPart;
  const message = {
    role: 'user',
    content: 'hello',
    name: '',
    parts: [part],
    toolCalls: [],
    toolCallId: '',
    toolResults: [],
    toolApprovalResponses: [],
  } satisfies ChatMessage;
  const request = {
    scenarioType: ScenarioType.TEXT_GENERATE,
  } satisfies Partial<ExecuteScenarioRequest>;
  const response = {
    accepted: true,
  } satisfies Partial<ExecuteScenarioResponse>;
  const artifact = {
    artifactId: 'artifact-1',
  } satisfies Partial<ScenarioArtifact>;

  assert.equal(projection.accountId, 'acct-1');
  assert.equal(message.parts[0]?.type, ChatContentPartType.TEXT);
  assert.equal(request.scenarioType, 1);
  assert.equal(response.accepted, true);
  assert.equal(artifact.artifactId, 'artifact-1');
});

test('runtime wire-types source stays outside full generated runtime value graph', () => {
  assertWireTypesBoundary('runtime/wire-types/index.ts');
});

test('runtime wire-types build output contains no full generated runtime value imports', () => {
  assertWireTypesBoundary('dist/runtime/wire-types/index.js');
});

test('runtime/generated remains the full generated transport surface', () => {
  const source = readPackageFile('runtime/generated.ts');
  assert.match(source, /from '\.\.\/core-generated\/runtime-wire-codecs'/);
  assert.match(source, /from '\.\.\/core-generated\/runtime-typed-client'/);
});

test('runtime wire-types is exported as a public package subpath', () => {
  const packageJson = JSON.parse(readPackageFile('package.json')) as {
    readonly exports?: Record<string, unknown>;
  };
  assert.ok(packageJson.exports?.['./runtime/wire-types'], './runtime/wire-types must be present in package exports');
});
