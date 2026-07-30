import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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

test('Zhiyu chat turn apply guard accepts only the submitted opaque conversation tuple', async () => {
  const module = await importGuardModule();
  const submitted = identity({
    agentHandle: 'agent-handle:opaque-1',
    conversationAnchorId: 'agent-anchor:opaque-1',
    threadId: 'runtime-thread:opaque-1',
  });

  assert.equal(module.shouldApplyZhiyuRuntimeChatUpdate({
    currentConversation: identity({ ...submitted }),
    submittedConversation: submitted,
  }), true);
  assert.equal(module.shouldApplyZhiyuRuntimeChatUpdate({
    currentConversation: identity({ ...submitted, agentHandle: 'agent-handle:opaque-2' }),
    submittedConversation: submitted,
  }), false);
  assert.equal(module.shouldApplyZhiyuRuntimeChatUpdate({
    currentConversation: identity({ ...submitted, conversationAnchorId: 'agent-anchor:opaque-2' }),
    submittedConversation: submitted,
  }), false);
  assert.equal(module.shouldApplyZhiyuRuntimeChatUpdate({
    currentConversation: identity({ ...submitted, threadId: 'runtime-thread:opaque-2' }),
    submittedConversation: submitted,
  }), false);
  assert.equal(module.shouldApplyZhiyuRuntimeChatUpdate({
    currentConversation: identity({ ...submitted }),
    submittedConversation: identity({ ...submitted, threadId: null }),
  }), false);
});

test('Zhiyu chat turn submit continuation guard stops after abort or opaque tuple change', async () => {
  const module = await importGuardModule();
  const submitted = identity({
    agentHandle: 'agent-handle:opaque-1',
    conversationAnchorId: 'agent-anchor:opaque-1',
    threadId: 'runtime-thread:opaque-1',
  });
  const activeAbort = new AbortController();
  const aborted = new AbortController();
  aborted.abort('zhiyu_chat_turn_local_agent_changed');

  assert.equal(module.shouldContinueZhiyuRuntimeChatSubmit({
    currentConversation: identity({ ...submitted }),
    submittedConversation: submitted,
    signal: activeAbort.signal,
  }), true);
  assert.equal(module.shouldContinueZhiyuRuntimeChatSubmit({
    currentConversation: identity({ ...submitted }),
    submittedConversation: submitted,
    signal: aborted.signal,
  }), false);
  assert.equal(module.shouldContinueZhiyuRuntimeChatSubmit({
    currentConversation: identity({ ...submitted, agentHandle: 'agent-handle:opaque-2' }),
    submittedConversation: submitted,
    signal: activeAbort.signal,
  }), false);
});

async function importGuardModule() {
  const outputPath = path.join(await buildGuardModule(), 'chat-turn-apply-guard.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildGuardModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-chat-turn-apply-guard-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/app/chat-turn-apply-guard.ts')],
    outfile: path.join(buildDir, 'chat-turn-apply-guard.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  return buildDir;
}

function identity(overrides) {
  return {
    agentHandle: null,
    conversationAnchorId: null,
    threadId: null,
    ...overrides,
  };
}
