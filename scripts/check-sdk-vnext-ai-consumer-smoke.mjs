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
  collectNimiTextStream,
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
} from '@nimiplatform/sdk/ai';

const runtimeCalls = [];
const runtimeModel = createNimiRuntimeAIModel({
  appId: 'consumer-app',
  subjectUserId: 'consumer-user',
  runtime: {
    async executeScenario(request) {
      runtimeCalls.push(request);
      return {
        output: {
          output: {
            oneofKind: 'textGenerate',
            textGenerate: {
              text: 'runtime text',
              toolCalls: [],
              sources: [],
              rawChunks: [],
              items: [{ item: { oneofKind: 'text', text: { text: 'runtime text' } } }],
              reasoningSummary: '',
            },
          },
        },
        finishReason: 1,
        usage: { inputTokens: '2', outputTokens: '3', computeMs: '4' },
        routeDecision: 1,
        modelResolved: 'runtime-owned-model',
        traceId: 'trace-runtime',
        ignoredExtensions: [],
      };
    },
    async *streamScenario(request) {
      runtimeCalls.push(request);
      yield { eventType: 1, sequence: '1', traceId: 'trace-stream', payload: { oneofKind: 'started', started: { modelResolved: 'runtime-owned-model', routeDecision: 1 } } };
      yield {
        eventType: 2,
        sequence: '2',
        traceId: 'trace-stream',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'textOutputItem',
              textOutputItem: {
                itemIndex: 0,
                delta: { oneofKind: 'text', text: { text: 'stream text' } },
                itemCompleted: true,
              },
            },
          },
        },
      };
      yield { eventType: 6, sequence: '3', traceId: 'trace-stream', payload: { oneofKind: 'completed', completed: { finishReason: 1, usage: { inputTokens: '1', outputTokens: '2', computeMs: '3' }, streamSimulated: false } } };
    },
  },
});
assert.deepEqual(runtimeModel.model, { modelId: 'text.generate' });
const generated = await runtimeModel.generateText({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
});
assert.equal(generated.text, 'runtime text');
assert.deepEqual(generated.outputItems, [{ type: 'text', text: 'runtime text' }]);
const streamed = await collectNimiTextStream(await runtimeModel.streamText({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
}));
assert.equal(streamed.text, 'stream text');
assert.deepEqual(streamed.outputItems, [{ type: 'text', text: 'stream text' }]);
assert.deepEqual(runtimeCalls[0].head, {
  appId: 'consumer-app',
  subjectUserId: 'consumer-user',
  timeoutMs: 0,
});
assert.doesNotMatch(JSON.stringify(runtimeCalls), /modelId|routePolicy|connectorId|targetRef|fallbackPolicy/);

const embeddingCalls = [];
const embedding = createNimiRuntimeEmbeddingClient({
  appId: 'consumer-app',
  subjectUserId: 'consumer-user',
  runtime: {
    async executeScenario(request) {
      embeddingCalls.push(request);
      return {
        output: { output: { oneofKind: 'textEmbed', textEmbed: { vectors: [{ values: [0.1, 0.2] }] } } },
        finishReason: 1,
        usage: { inputTokens: '1', outputTokens: '0', computeMs: '2' },
        routeDecision: 1,
        modelResolved: 'runtime-owned-embedder',
        traceId: 'trace-embed',
        ignoredExtensions: [],
      };
    },
  },
});
const embedded = await embedding.embedText({ values: ['consumer query'] });
assert.deepEqual(embedded.embeddings, [[0.1, 0.2]]);
assert.deepEqual(embeddingCalls[0].head, {
  appId: 'consumer-app',
  subjectUserId: 'consumer-user',
  timeoutMs: 0,
});
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  type NimiGenerateTextRequest,
  type NimiRuntimeEmbeddingSurface,
  type NimiRuntimeAIScenarioClient,
} from '@nimiplatform/sdk/ai';

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
  runtime,
});
createNimiRuntimeAIModel({
  appId: 'typed-app',
  runtime,
  // @ts-expect-error Runtime chooses the implementation; callers cannot provide a model target.
  model: { modelId: 'retired-target' },
});
const contentOnlyRequest: NimiGenerateTextRequest = { messages: [] };
const retiredModelRequest: NimiGenerateTextRequest = {
  messages: [],
  // @ts-expect-error Text requests cannot carry caller-owned model selection.
  model: { modelId: 'retired-target' },
};
const embedding: NimiRuntimeEmbeddingSurface = createNimiRuntimeEmbeddingClient({
  appId: 'typed-app',
  runtime: {
    async executeScenario() {
      throw new Error('typed only');
    },
  },
});
void model;
void contentOnlyRequest;
void retiredModelRequest;
void embedding;
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
    '--dir', vnextRoot, 'exec', 'tsc', '-p', path.join(tempRoot, 'tsconfig.json'),
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
