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

test('Zhiyu Runtime Agent binding decision fails closed when no Runtime authority is present', async () => {
  const module = await importBindingModule();
  const decision = module.resolveZhiyuRuntimeAgentBindingDecision();
  let called = false;

  assert.equal(decision.kind, 'missing');
  await assert.rejects(
    () => module.withZhiyuRuntimeAgentBindingScopes(decision, ['runtime.agent.turn.write'], async () => {
      called = true;
      return 'not allowed';
    }),
    (error) => error?.reasonCode === 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED'
      && error?.actionHint === 'attach_runtime_scoped_binding_or_admitted_host_equivalence',
  );
  assert.equal(called, false);
});

test('Zhiyu Runtime Agent binding decision exposes Runtime-issued scoped binding for turn requests', async () => {
  const module = await importBindingModule();
  const decision = module.resolveZhiyuRuntimeAgentBindingDecision({
    scopedBinding: {
      bindingId: 'binding-1',
      bindingHandle: 'runtime.binding/binding-1',
      runtimeAppId: 'runtime.agent',
      appInstanceId: 'nimi.zhiyu.local',
      windowId: 'window-1',
      agentId: 'local-agent-1',
      conversationAnchorId: 'conversation-1',
      worldId: 'world-1',
    },
  });

  assert.equal(decision.kind, 'runtime-issued-scoped-binding');
  assert.deepEqual(module.scopedBindingForRuntimeAgentRequest(decision), {
    bindingId: 'binding-1',
    bindingHandle: 'runtime.binding/binding-1',
    runtimeAppId: 'runtime.agent',
    appInstanceId: 'nimi.zhiyu.local',
    windowId: 'window-1',
    avatarInstanceId: '',
    agentId: 'local-agent-1',
    conversationAnchorId: 'conversation-1',
    worldId: 'world-1',
  });

  const result = await module.withZhiyuRuntimeAgentBindingScopes(decision, ['runtime.agent.turn.write'], async (options) => {
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-id'], 'binding-1');
    return 'allowed';
  });
  assert.equal(result, 'allowed');
});

test('Zhiyu Runtime Agent host equivalence requires Runtime SDK authority evidence and fail-closed semantics', async () => {
  const module = await importBindingModule();

  assert.equal(module.resolveZhiyuRuntimeAgentBindingDecision({
    hostEquivalence: {
      evidenceRef: 'zhiyu-local-note-only',
      authority: 'zhiyu',
      failureSemantics: 'fail-closed',
    },
  }).kind, 'missing');

  const decision = module.resolveZhiyuRuntimeAgentBindingDecision({
    hostEquivalence: {
      evidenceRef: 'runtime-sdk-authority:installed-app-host-equivalence',
      authority: 'runtime-sdk',
      failureSemantics: 'fail-closed',
    },
  });

  assert.equal(decision.kind, 'runtime-sdk-authority-admitted-first-party-electron-host-equivalence');
  assert.equal(module.scopedBindingForRuntimeAgentRequest(decision), undefined);

  const result = await module.withZhiyuRuntimeAgentBindingScopes(decision, ['runtime.agent.read'], async (options) => {
    assert.equal(
      options.metadata['x-nimi-runtime-host-equivalence'],
      'runtime-sdk-authority:installed-app-host-equivalence',
    );
    return 'allowed';
  });
  assert.equal(result, 'allowed');
});

async function importBindingModule() {
  const outputPath = path.join(await buildBindingModule(), 'runtime-agent-binding.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildBindingModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-runtime-agent-binding-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/runtime-agent-binding.ts')],
    outfile: path.join(buildDir, 'runtime-agent-binding.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  return buildDir;
}
