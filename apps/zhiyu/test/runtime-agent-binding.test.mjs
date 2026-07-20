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
      && error?.actionHint === 'attach_runtime_scoped_binding_or_protected_local_app_carrier',
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
      scopes: ['runtime.agent.turn.write'],
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
    scopes: ['runtime.agent.turn.write'],
  });

  const result = await module.withZhiyuRuntimeAgentBindingScopes(decision, ['runtime.agent.turn.write'], async (options) => {
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-id'], 'binding-1');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-handle'], 'runtime.binding/binding-1');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-runtime-app-id'], 'runtime.agent');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-app-instance-id'], 'nimi.zhiyu.local');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-agent-id'], 'local-agent-1');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-conversation-anchor-id'], 'conversation-1');
    assert.equal(options.metadata['x-nimi-runtime-scoped-binding-world-id'], 'world-1');
    return 'allowed';
  });
  assert.equal(result, 'allowed');
});

test('Zhiyu Runtime Agent delegation binding is issued through Electron Runtime bridge and cached until renewal', async () => {
  const module = await importBindingModule();
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      assert.equal(command, 'zhiyu.runtimeAgent.issueScopedBinding');
      return {
        scopedBinding: {
          bindingId: `binding-delegation-${calls.length}`,
          bindingHandle: `binding:binding-delegation-${calls.length}`,
          runtimeAppId: 'nimi.zhiyu',
          appInstanceId: 'nimi.zhiyu.local-first-party',
          windowId: '',
          avatarInstanceId: '',
          agentId: payload.localAgentRef,
          conversationAnchorId: payload.conversationAnchorId,
          worldId: '',
          bindingSource: 'runtime-account-service',
          expiresAtMs: Date.now() + 120_000,
          scopes: payload.scopes,
        },
      };
    },
  };
  try {
    const request = {
      ownerUserId: 'acct_1',
      runtimeSourceRef: 'runtime-source:opaque',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'agent_anchor_1',
      scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    };
    const first = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(request);
    const second = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(request);
    const renewed = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost({
      ...request,
      issueRequestId: 'renewal-request-1',
      forceRenewal: true,
    });

    assert.equal(first.kind, 'runtime-issued-scoped-binding');
    assert.equal(second.kind, 'runtime-issued-scoped-binding');
    assert.equal(renewed.kind, 'runtime-issued-scoped-binding');
    assert.equal(first.scopedBinding.bindingSource, 'runtime-account-service');
    assert.equal(first.scopedBinding.agentId, 'local-agent:opaque');
    assert.equal(first.scopedBinding.conversationAnchorId, 'agent_anchor_1');
    assert.equal(second.scopedBinding.bindingId, 'binding-delegation-1');
    assert.equal(renewed.scopedBinding.bindingId, 'binding-delegation-2');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].payload.ownerUserId, request.ownerUserId);
    assert.equal(calls[0].payload.localAgentRef, request.localAgentRef);
    assert.match(calls[0].payload.issueRequestId, /^issue-/);
    assert.equal(calls[0].payload.forceRenewal, false);
    assert.equal(calls[1].payload.issueRequestId, 'renewal-request-1');
    assert.equal(calls[1].payload.forceRenewal, true);
    assert.equal(globalThis.__nimiZhiyuRuntimeAgentBinding.scopedBinding.bindingId, 'binding-delegation-2');
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
    delete globalThis.__nimiZhiyuRuntimeAgentBinding;
  }
});

test('Zhiyu Runtime Agent scoped binding issuance coalesces concurrent identical requests', async () => {
  const module = await importBindingModule();
  const calls = [];
  let releaseIssue;
  const issueBlocker = new Promise((resolve) => {
    releaseIssue = resolve;
  });
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      const sequence = calls.length;
      assert.equal(command, 'zhiyu.runtimeAgent.issueScopedBinding');
      await issueBlocker;
      return {
        scopedBinding: {
          bindingId: `binding-concurrent-${sequence}`,
          bindingHandle: `binding:binding-concurrent-${sequence}`,
          runtimeAppId: 'nimi.zhiyu',
          appInstanceId: 'nimi.zhiyu.local-first-party',
          agentId: payload.localAgentRef,
          conversationAnchorId: payload.conversationAnchorId,
          bindingSource: 'runtime-account-service',
          expiresAtMs: Date.now() + 120_000,
          scopes: payload.scopes,
        },
      };
    },
  };
  try {
    const request = {
      ownerUserId: 'acct_concurrent',
      runtimeSourceRef: 'runtime-source:concurrent',
      localAgentRef: 'local-agent:concurrent',
      conversationAnchorId: 'agent_anchor_concurrent',
      scopes: ['runtime.agent.delegation.write', 'runtime.agent.delegation.read'],
    };
    const first = module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(request);
    const second = module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost({
      ...request,
      scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    });
    await Promise.resolve();
    assert.equal(calls.length, 1);
    releaseIssue();
    const [firstDecision, secondDecision] = await Promise.all([first, second]);

    assert.equal(firstDecision.kind, 'runtime-issued-scoped-binding');
    assert.equal(secondDecision.kind, 'runtime-issued-scoped-binding');
    assert.equal(firstDecision.scopedBinding.bindingId, 'binding-concurrent-1');
    assert.equal(secondDecision.scopedBinding.bindingId, 'binding-concurrent-1');
    assert.deepEqual(calls[0].payload.scopes, [
      'runtime.agent.delegation.read',
      'runtime.agent.delegation.write',
    ]);
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
    delete globalThis.__nimiZhiyuRuntimeAgentBinding;
  }
});

test('Zhiyu Runtime Agent delegation binding renews when cached binding is inside refresh skew', async () => {
  const module = await importBindingModule();
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      assert.equal(command, 'zhiyu.runtimeAgent.issueScopedBinding');
      return {
        scopedBinding: {
          bindingId: `binding-near-expiry-${calls.length}`,
          bindingHandle: `binding:binding-near-expiry-${calls.length}`,
          runtimeAppId: 'nimi.zhiyu',
          appInstanceId: 'nimi.zhiyu.local-first-party',
          agentId: payload.localAgentRef,
          conversationAnchorId: payload.conversationAnchorId,
          bindingSource: 'runtime-account-service',
          expiresAtMs: Date.now() + 30_000,
          scopes: payload.scopes,
        },
      };
    },
  };
  try {
    const request = {
      ownerUserId: 'acct_near_expiry',
      runtimeSourceRef: 'runtime-source:near-expiry',
      localAgentRef: 'local-agent:near-expiry',
      conversationAnchorId: 'agent_anchor_near_expiry',
      scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    };
    const first = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(request);
    const renewed = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost(request);

    assert.equal(first.kind, 'runtime-issued-scoped-binding');
    assert.equal(renewed.kind, 'runtime-issued-scoped-binding');
    assert.equal(first.scopedBinding.bindingId, 'binding-near-expiry-1');
    assert.equal(renewed.scopedBinding.bindingId, 'binding-near-expiry-2');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].payload.issueRequestId, calls[1].payload.issueRequestId);
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
    delete globalThis.__nimiZhiyuRuntimeAgentBinding;
  }
});

test('Zhiyu Runtime Agent scoped binding issuance fails closed when returned scopes do not cover the request', async () => {
  const module = await importBindingModule();
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async () => ({
      scopedBinding: {
        bindingId: 'binding-scope-mismatch',
        bindingHandle: 'binding:binding-scope-mismatch',
        runtimeAppId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        agentId: 'local-agent:scope-mismatch',
        conversationAnchorId: 'agent_anchor_scope_mismatch',
        bindingSource: 'runtime-account-service',
        expiresAtMs: Date.now() + 120_000,
        scopes: ['runtime.agent.delegation.read'],
      },
    }),
  };
  try {
    await assert.rejects(
      () => module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost({
        ownerUserId: 'acct_1',
        runtimeSourceRef: 'runtime-source:opaque',
        localAgentRef: 'local-agent:scope-mismatch',
        conversationAnchorId: 'agent_anchor_scope_mismatch',
        scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
      }),
      (error) => error?.reasonCode === 'zhiyu-runtime-agent-scoped-binding-scope-missing',
    );
    assert.equal(globalThis.__nimiZhiyuRuntimeAgentBinding, undefined);
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
    delete globalThis.__nimiZhiyuRuntimeAgentBinding;
  }
});

test('Zhiyu Runtime Agent delegation binding installs through contextBridge-style immutable binding host', async () => {
  const module = await importBindingModule();
  const previousWindow = globalThis.window;
  let scopedBindingEvidence = null;
  const bindingHost = {
    localAppCarrier: {
      kind: 'protected-local-app-carrier',
    },
    getScopedBinding: () => scopedBindingEvidence,
    setScopedBinding: (scopedBinding) => {
      scopedBindingEvidence = { ...scopedBinding };
      return scopedBindingEvidence;
    },
  };
  globalThis.window = {};
  Object.defineProperty(globalThis.window, '__nimiZhiyuRuntimeAgentBinding', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: bindingHost,
  });
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: async () => ({
      scopedBinding: {
        bindingId: 'binding-context-bridge-1',
        bindingHandle: 'binding:binding-context-bridge-1',
        runtimeAppId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        agentId: 'local-agent:context-bridge',
        conversationAnchorId: 'agent_anchor_context_bridge',
        bindingSource: 'runtime-account-service',
        expiresAtMs: Date.now() + 120_000,
        scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
      },
    }),
  };
  try {
    const decision = await module.resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost({
      ownerUserId: 'acct_1',
      runtimeSourceRef: 'runtime-source:opaque',
      localAgentRef: 'local-agent:context-bridge',
      conversationAnchorId: 'agent_anchor_context_bridge',
      scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    });

    assert.equal(decision.kind, 'runtime-issued-scoped-binding');
    assert.equal(scopedBindingEvidence.bindingId, 'binding-context-bridge-1');
    const hostDecision = module.resolveZhiyuRuntimeAgentBindingDecisionFromHost();
    assert.equal(hostDecision.kind, 'runtime-issued-scoped-binding');
    assert.equal(hostDecision.scopedBinding.bindingSource, 'runtime-account-service');
    const turnDecision = module.resolveZhiyuRuntimeAgentBindingDecisionFromHost(['runtime.agent.turn.write']);
    assert.equal(turnDecision.kind, 'local-app-carrier');
    assert.equal(globalThis.window.__nimiZhiyuRuntimeAgentBinding, bindingHost);
  } finally {
    delete globalThis.__NIMI_ELECTRON_TEST__;
    delete globalThis.window;
    if (previousWindow !== undefined) {
      globalThis.window = previousWindow;
    }
  }
});

test('Zhiyu Runtime Agent rejects host equivalence and uses the protected local-app carrier without metadata', async () => {
  const module = await importBindingModule();

  assert.equal(module.resolveZhiyuRuntimeAgentBindingDecision({
    hostEquivalence: {
      evidenceRef: 'zhiyu-local-note-only',
      authority: 'zhiyu',
      failureSemantics: 'fail-closed',
    },
  }).kind, 'missing');

  const decision = module.resolveZhiyuRuntimeAgentBindingDecision({
    localAppCarrier: {
      kind: 'protected-local-app-carrier',
    },
  });

  assert.equal(decision.kind, 'local-app-carrier');
  assert.equal(module.scopedBindingForRuntimeAgentRequest(decision), undefined);

  const result = await module.withZhiyuRuntimeAgentBindingScopes(decision, ['runtime.agent.read'], async (options) => {
    assert.deepEqual(options, {});
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
