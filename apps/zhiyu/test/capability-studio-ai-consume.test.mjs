import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu Capability Studio delegates core AI consume to the shared Kit helper', async () => {
  const module = await importCapabilityStudioConsume();
  const captured = [];
  const runtime = { ai: {}, scheduling: {} };
  const result = await module.runZhiyuCapabilityStudioAIConsume({
    runtime,
    config: createAIConfig(),
    capabilityId: 'chat.stream',
    prompt: 'hello shared consume',
    subjectUserId: 'subject-user-1',
    onPartial: (text) => captured.push(['partial', text]),
    consume: async (input) => {
      captured.push(['consume', input]);
      input.onPartial?.('shared partial');
      return {
        ok: true,
        capabilityId: input.capabilityId,
        message: 'stream complete',
        output: {
          kind: 'text',
          text: 'shared response',
          finishReason: 'stop',
          streamed: true,
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(captured[0][0], 'consume');
  const delegated = captured[0][1];
  assert.equal(delegated.runtime, runtime);
  assert.equal(delegated.appId, 'nimi.zhiyu');
  assert.deepEqual(delegated.config, createAIConfig());
  assert.equal(delegated.capabilityId, 'chat.stream');
  assert.equal(delegated.bindingCapabilityId, 'text.generate');
  assert.equal(delegated.prompt, 'hello shared consume');
  assert.equal(delegated.scenarioId, 'zhiyu-capability-studio-chat-stream');
  assert.equal(delegated.subjectUserId, 'subject-user-1');
  assert.equal(delegated.surfaceId, 'zhiyu.capability-studio.chat.stream');
  assert.deepEqual(delegated.metadata, {
    productSurface: 'capability-studio',
    zhiyuSurface: 'agent-home',
  });
  assert.equal(typeof delegated.onPartial, 'function');
  assert.deepEqual(captured[1], ['partial', 'shared partial']);
});

test('Zhiyu Capability Studio source imports the Kit generation runtime helper and no private app source', async () => {
  const source = await readFile(path.join(root, 'src/shell/capability-studio/zhiyu-ai-consume.ts'), 'utf8');
  assert.match(source, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.doesNotMatch(source, /apps\/tester|apps\/desktop|runtime\/internal/);
  assert.doesNotMatch(source, /executeScenario\(|streamScenario\(|fetch\(/);
});

async function importCapabilityStudioConsume() {
  const outputPath = path.join(await buildCapabilityStudioConsume(), 'zhiyu-ai-consume.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildCapabilityStudioConsume() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-capability-studio-consume-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/capability-studio/zhiyu-ai-consume.ts')],
    outfile: path.join(buildDir, 'zhiyu-ai-consume.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const source = await readFile(path.join(root, 'src/shell/capability-studio/zhiyu-ai-consume.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu Capability Studio consume wrapper: ${error.message}\nsource length=${source.length}`);
  });
  return buildDir;
}

function createAIConfig() {
  return {
    scopeRef: {
      kind: 'app',
      ownerId: 'nimi.zhiyu',
      surfaceId: 'zhiyu-agent-home',
    },
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'runtime-agent-live-e2e',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
}
