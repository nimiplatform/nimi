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
  process.stdout.write(`[check-sdk-vnext-ai-runner-consumer-smoke] ${label}\n`);
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
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-ai-runner-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  createNimiAiRunner,
  runNimiAiTextGenerate,
  runNimiAiTextTurn,
  streamNimiAiTextResponse,
} from '@nimiplatform/sdk/ai-runner';
import {
  buildNimiConversationHistoryMessages,
  buildNimiConversationHistoryWindow,
  measureNimiConversationHistoryWindow,
} from '@nimiplatform/sdk/features/conversation';
import {
  createNimiRuntimeKnowledgeContextClient,
} from '@nimiplatform/sdk/features/knowledge-context';
import {
  createNimiAppPrivateMemoryBankLocator,
  createNimiRuntimeMemoryContextClient,
} from '@nimiplatform/sdk/features/memory-context';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiRuntimeGenerationClient,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
} from '@nimiplatform/sdk/features/generation';
import {
  buildNimiStructuredOutputRepairRequest,
  parseNimiStructuredJson,
} from '@nimiplatform/sdk/features/evaluation';
import {
  createNimiApprovalTool,
  createNimiExternalExecutionTool,
  createNimiToolRegistry,
} from '@nimiplatform/sdk/features/toolkits';
import {
  createNimiMockModel,
  createNimiToolCall,
  userTextMessage,
} from '@nimiplatform/sdk/testing';

const structured = await runNimiAiTextGenerate({
  runner: { id: 'runner', name: 'Runner', instructions: 'Return JSON.' },
  runtime: { model: createNimiMockModel({ text: '{"answer":"yes"}', finishReason: 'stop' }) },
  messages: [userTextMessage('answer')],
  structuredOutput: { expect: 'object' },
});
assert.equal(structured.ok, false);
assert.equal(structured.ok ? '' : structured.error.code, 'SDK_RUNTIME_AGENT_PARTICIPATION_REQUIRED');

const streamEvents = [];
for await (const event of runNimiAiTextTurn({
  runner: { id: 'runner', name: 'Runner' },
  runtime: {
    model: createNimiMockModel({
      streamEvents: [
        { type: 'start', traceId: 'trace-runner' },
        { type: 'reasoning-delta', text: 'think ' },
        { type: 'text-delta', text: 'hello' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      ],
    }),
  },
  messages: [userTextMessage('stream')],
})) {
  streamEvents.push(event.type);
}
assert.deepEqual(streamEvents, ['turn-started', 'turn-failed']);

await assert.rejects(
  () => streamNimiAiTextResponse({
    runner: { id: 'runner', name: 'Runner' },
    runtime: {
      model: createNimiMockModel({
        streamEvents: [
          { type: 'start' },
          { type: 'text-delta', text: 'partial' },
          { type: 'error', code: 'RUNTIME_FAILED', message: 'runtime failed' },
        ],
      }),
    },
    messages: [userTextMessage('stream')],
  }),
  /Runtime Agent participation authority/,
);

const history = buildNimiConversationHistoryMessages({
  messages: [
    { id: 'draft', role: 'user', text: 'draft', committed: false },
    { id: 'u1', role: 'user', text: 'one', committed: true },
    { id: 'a1', role: 'assistant', text: 'two', committed: true },
  ],
  isCommitted: (message) => message.committed,
  getId: (message) => message.id,
  getRole: (message) => message.role,
  getText: (message) => message.text,
});
const window = buildNimiConversationHistoryWindow(history, { maxMessages: 2, maxTokenEstimate: 10 });
assert.equal(measureNimiConversationHistoryWindow(window, 2).totalWithReserve >= 4, true);

const parsed = parseNimiStructuredJson({ raw: 'x {"ok":true}', expect: 'object' });
assert.equal(parsed.ok, true);
const failed = parseNimiStructuredJson({ raw: 'not-json', expect: 'object' });
assert.equal(failed.ok, false);
assert.equal(buildNimiStructuredOutputRepairRequest({ failure: failed, originalText: 'not-json' }).failureReason, 'invalid-json');

const registry = createNimiToolRegistry([
  { name: 'local', description: 'Local tool', inputSchema: {}, execute: () => ({ ok: true }) },
  createNimiApprovalTool({ name: 'approval', description: 'Approval tool' }),
  createNimiExternalExecutionTool({ name: 'external', description: 'External tool' }),
]);
assert.equal((await registry.execute({ toolName: 'local' })).ok, true);
assert.equal((await registry.execute({ toolName: 'approval' })).reason, 'approval-required');
assert.equal((await registry.execute({ toolName: 'external' })).reason, 'external-execution-required');

const memoryBank = createNimiAppPrivateMemoryBankLocator({ accountId: 'acct', appId: 'consumer-app' });
const memory = createNimiRuntimeMemoryContextClient({
  context: { appId: 'consumer-app', subjectUserId: 'user' },
  bank: memoryBank,
  runtime: {
    memory: {
      async recall(request) {
        assert.equal(request.query.query, 'preference');
        return {
          hits: [{
            relevanceScore: 0.9,
            matchReason: 'semantic',
            record: {
              memoryId: 'mem-1',
              kind: 2,
              canonicalClass: 1,
              payload: { oneofKind: 'semantic', semantic: { subject: 'Mira', predicate: 'prefers', object: 'green tea', confidence: 0.9 } },
            },
          }],
          narrativeHits: [],
        };
      },
      async history() { return { records: [], nextPageToken: '' }; },
    },
  },
});
assert.equal((await memory.recall({ query: 'preference' })).snippets[0].text, 'Mira prefers green tea');

const knowledge = createNimiRuntimeKnowledgeContextClient({
  context: { appId: 'consumer-app', subjectUserId: 'user' },
  runtime: {
    knowledge: {
      async listKnowledgeBanks() { return { banks: [{ bankId: 'kb-1', displayName: 'Docs' }], nextPageToken: '' }; },
      async searchKeyword() { throw new Error('keyword not used'); },
      async searchHybrid(request) {
        assert.equal(request.bankId, 'kb-1');
        return { hits: [{ bankId: 'kb-1', pageId: 'page-1', slug: 'guide', title: 'Guide', snippet: 'Runtime knowledge', score: 0.8 }], nextPageToken: '', reasonCode: 0 };
      },
    },
  },
});
assert.equal((await knowledge.search({ query: 'guide', bankIds: ['kb-1'] })).references[0].text, 'Runtime knowledge');

const generation = createNimiRuntimeGenerationClient({
  head: {
    appId: 'consumer-app',
  },
  runtime: {
    ai: {
      async submitScenarioJob(request) {
        assert.equal(request.executionMode, 3);
        return { job: { jobId: 'job-1', scenarioType: 3, executionMode: 3, routeDecision: 1, modelResolved: 'image-model', status: 1, providerJobId: 'provider-job', reasonCode: 0, reasonDetail: '', retryCount: 0, artifacts: [], traceId: 'trace-job', ignoredExtensions: [], progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0 } };
      },
      async getScenarioJob() { throw new Error('get not used'); },
      async cancelScenarioJob() { throw new Error('cancel not used'); },
      async *subscribeScenarioJobEvents() { return; },
      async getScenarioArtifacts() {
        return { jobId: 'job-1', traceId: 'trace-job', artifacts: [{ artifactId: 'artifact-1', mimeType: 'image/png', bytes: new Uint8Array(), uri: 'runtime://artifact-1', sha256: 'sha', sizeBytes: '3', durationMs: '0', fps: 0, width: 64, height: 64, sampleRateHz: 0, channels: 0 }] };
      },
    },
    artifacts: {
      async readArtifactBytes() { return { bytes: new Uint8Array([1]), mimeType: 'image/png', sizeBytes: '1', mimeInferred: false }; },
    },
  },
});
const videoScenario = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'consumer-app',
  },
  {
    scenario: createNimiVideoGenerationScenario({
      kind: 'video',
      mode: 't2v',
      prompt: 'animate',
      options: { durationSec: 4 },
    }),
    requestId: 'video-request',
    idempotencyKey: 'video-idem',
  },
);
assert.equal(videoScenario.scenarioType, 4);
assert.equal(videoScenario.spec.spec.oneofKind, 'videoGenerate');
const ttsScenario = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'consumer-app',
  },
  {
    scenario: createNimiSpeechSynthesisScenario({ kind: 'speech-synthesize', text: 'hello' }),
    requestId: 'tts-request',
    idempotencyKey: 'tts-idem',
  },
);
assert.equal(ttsScenario.scenarioType, 5);
const sttScenario = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'consumer-app',
  },
  {
    scenario: createNimiSpeechTranscriptionScenario({
      kind: 'speech-transcribe',
      mimeType: 'audio/wav',
      audio: { type: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
    }),
    requestId: 'stt-request',
    idempotencyKey: 'stt-idem',
  },
);
assert.equal(sttScenario.scenarioType, 6);
assert.equal((await generation.submit({ scenario: { kind: 'image', prompt: 'image' }, requestId: 'request-1', idempotencyKey: 'idem-1' })).status, 'submitted');
assert.equal((await generation.artifacts('job-1'))[0].kind, 'image');
assert.equal((await generation.readArtifactBytes('artifact-1')).bytes.length, 1);

const runner = await createNimiAiRunner().run({
  runner: {
    id: 'tool-runner',
    name: 'Tool Runner',
    tools: [
      { name: 'local', inputSchema: {}, execute: () => ({ ok: true }) },
      createNimiApprovalTool({ name: 'approval', description: 'Approval tool' }),
    ],
  },
  model: createNimiMockModel({
    finishReason: 'tool-calls',
    toolCalls: [
      createNimiToolCall('local', {}, 'tool-local'),
      createNimiToolCall('approval', {}, 'tool-approval'),
    ],
  }),
  messages: [userTextMessage('tools')],
});
assert.equal(runner.events.some((event) => event.type === 'tool-result'), true);
assert.equal(runner.events.some((event) => event.type === 'approval-requested'), true);

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
  runNimiAiTextGenerate,
  type NimiAiTextGenerateResult,
  type NimiAiTextTurnEvent,
} from '@nimiplatform/sdk/ai-runner';
import {
  buildNimiConversationHistoryMessages,
  type NimiConversationMessage,
} from '@nimiplatform/sdk/features/conversation';
import {
  createNimiRuntimeKnowledgeContextClient,
  type NimiRuntimeKnowledgeContextClient,
} from '@nimiplatform/sdk/features/knowledge-context';
import {
  createNimiAppPrivateMemoryBankLocator,
  createNimiRuntimeMemoryContextClient,
  type NimiRuntimeMemoryContextClient,
} from '@nimiplatform/sdk/features/memory-context';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiRuntimeGenerationClient,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
  createNimiVideoGenerationScenario,
  type NimiRuntimeGenerationSurface,
} from '@nimiplatform/sdk/features/generation';
import {
  parseNimiStructuredJson,
  type NimiStructuredOutputParseResult,
} from '@nimiplatform/sdk/features/evaluation';
import {
  createNimiToolRegistry,
  type NimiToolCallResult,
} from '@nimiplatform/sdk/features/toolkits';
import { createNimiMockModel, userTextMessage } from '@nimiplatform/sdk/testing';

const result: Promise<NimiAiTextGenerateResult<{ ok: boolean }>> = runNimiAiTextGenerate({
  runner: { id: 'runner', name: 'Runner' },
  runtime: { model: createNimiMockModel({ text: '{"ok":true}', finishReason: 'stop' }) },
  messages: [userTextMessage('typed')],
  structuredOutput: { expect: 'object' },
});
const history: readonly NimiConversationMessage[] = buildNimiConversationHistoryMessages({
  messages: [{ id: '1', role: 'user', text: 'typed', committed: true }],
  isCommitted: (message) => message.committed,
  getId: (message) => message.id,
  getRole: (message) => message.role,
  getText: (message) => message.text,
});
const parsed: NimiStructuredOutputParseResult<{ ok: boolean }> = parseNimiStructuredJson({ raw: '{"ok":true}', expect: 'object' });
const registry = createNimiToolRegistry([{ name: 'local', description: 'Local tool', inputSchema: {}, execute: () => ({ ok: true }) }]);
const toolResult: Promise<NimiToolCallResult> = registry.execute({ toolName: 'local' });
const eventType: NimiAiTextTurnEvent['type'] = 'turn-started';
const memoryClient: NimiRuntimeMemoryContextClient = createNimiRuntimeMemoryContextClient({
  context: { appId: 'typed-app' },
  bank: createNimiAppPrivateMemoryBankLocator({ accountId: 'acct', appId: 'typed-app' }),
  runtime: {
    memory: {
      async recall() { throw new Error('typed only'); },
      async history() { throw new Error('typed only'); },
    },
  },
});
const knowledgeClient: NimiRuntimeKnowledgeContextClient = createNimiRuntimeKnowledgeContextClient({
  context: { appId: 'typed-app' },
  runtime: {
    knowledge: {
      async listKnowledgeBanks() { throw new Error('typed only'); },
      async searchKeyword() { throw new Error('typed only'); },
      async searchHybrid() { throw new Error('typed only'); },
    },
  },
});
const generationClient: NimiRuntimeGenerationSurface = createNimiRuntimeGenerationClient({
  head: {
    appId: 'typed-app',
  },
  runtime: {
    ai: {
      async submitScenarioJob() { throw new Error('typed only'); },
      async getScenarioJob() { throw new Error('typed only'); },
      async cancelScenarioJob() { throw new Error('typed only'); },
      async *subscribeScenarioJobEvents() { throw new Error('typed only'); },
      async getScenarioArtifacts() { throw new Error('typed only'); },
    },
  },
});
const videoRequest = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'typed-app',
  },
  { scenario: createNimiVideoGenerationScenario({ kind: 'video', mode: 't2v', prompt: 'typed' }), requestId: 'typed-video', idempotencyKey: 'typed-video-idem' },
);
const speechRequest = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'typed-app',
  },
  { scenario: createNimiSpeechSynthesisScenario({ kind: 'speech-synthesize', text: 'typed' }), requestId: 'typed-tts', idempotencyKey: 'typed-tts-idem' },
);
const transcriptionRequest = buildNimiRuntimeGenerationSubmitRequest(
  {
    appId: 'typed-app',
  },
  { scenario: createNimiSpeechTranscriptionScenario({ kind: 'speech-transcribe', mimeType: 'audio/wav', audio: { type: 'bytes', bytes: new Uint8Array([1]) } }), requestId: 'typed-stt', idempotencyKey: 'typed-stt-idem' },
);
void result;
void history;
void parsed;
void toolResult;
void eventType;
void memoryClient;
void knowledgeClient;
void generationClient;
void videoRequest;
void speechRequest;
void transcriptionRequest;
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
  process.stdout.write('SDK vNext AI runner consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-ai-runner-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-ai-runner-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
