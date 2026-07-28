import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  parseShellProductState,
  SIMULATOR_PRODUCT_COMMANDS as CMD,
} from '../../src/state-engine/product-state.ts';
import { SIMULATOR_PRODUCT_FLOWS } from '../../src/state-engine/product-flows.ts';
import { validateSimulatorScenario } from '../../build/config.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHELL = Object.freeze({ kind: 'shell', moduleId: null, instanceId: null });
const SCENARIO = Object.freeze({ kind: 'scenario', moduleId: null, instanceId: null });

const validated = validateSimulatorScenario(parse(
  readFileSync(path.join(REPO_ROOT, 'config/simulator/scenario.yaml'), 'utf8'),
));

function scenarioOptions() {
  return {
    scenarioId: validated.scenario_id,
    scenarioRevision: validated.scenario_revision,
    seed: validated.seed,
    initialLogicalTime: validated.initial_logical_time,
    scenarioState: validated.state.scenario,
    ecosystemState: validated.state.ecosystem,
    shellState: validated.state.shell,
  };
}

function createEngine() {
  return createSimulatorStateEngine({ scenario: scenarioOptions() });
}

function productOf(engine) {
  const shell = engine.getCommitted().partitions.shell;
  return shell.product;
}

async function dispatch(engine, type, payload, issuer = SHELL) {
  const result = await engine.acceptCommand(type, payload, issuer);
  return result;
}

function stepCurrentFlow(engine) {
  const { flowId, stepIndex } = productOf(engine).flow;
  return dispatch(engine, CMD.flowStep, { flowId, stepIndex });
}

test('scenario seeds the shell product partition with grants, ledger, and idle flow', () => {
  const engine = createEngine();
  const product = productOf(engine);
  assert.equal(product.persona, null);
  assert.deepEqual(product.agent, { status: 'idle', location: 'cradle', carry: null });
  assert.equal(product.grants.length, 5);
  assert.deepEqual(product.grants.map((grant) => [
    grant.id,
    grant.status,
    grant.day,
    grant.generatedDate,
  ]), [
    ['g-world-write', 'active', 'today', '2026-07-27'],
    ['g-presence-read', 'active', 'today', '2026-07-27'],
    ['g-local-agent-context-projection', 'revoked', 'earlier', '2026-07-26'],
    ['g-journal-read', 'pending', 'today', '2026-07-27'],
    ['g-footprint-weekly', 'pending', 'earlier', '2026-07-24'],
  ]);
  assert.equal(product.ledger.length, 6);
  assert.equal(product.ledger.filter((entry) => entry.history === true).length, 3);
  assert.equal(product.consent, null);
  assert.deepEqual(product.flow, { flowId: null, stepIndex: 0, status: 'idle', currentDirective: null });
  assert.equal(product.opSeq, 12);
});

test('grant toggle flips status and appends a deterministic delegation ledger entry', async () => {
  const engine = createEngine();
  const before = engine.getCommitted().revision;
  const result = await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { grantId: 'g-local-agent-context-projection', status: 'active' });
  const product = productOf(engine);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'active');
  assert.equal(product.ledger.length, 7);
  const entry = product.ledger.at(-1);
  assert.equal(entry.id, '1:op:013');
  assert.equal(entry.kind, 'delegation');
  assert.equal(entry.title, '重新授权 · context 携带');
  assert.equal(entry.result, 'committed');
  assert.equal(entry.at, 'T+00:13');
  assert.deepEqual(entry.actors, ['模拟居民', 'Nimi (LocalAgent)']);
  assert.equal(engine.getCommitted().revision, before + 1);

  const back = await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' });
  assert.equal(back.ok, true);
  assert.deepEqual(back.value, { grantId: 'g-local-agent-context-projection', status: 'revoked' });
  const reverted = productOf(engine).ledger.at(-1);
  assert.equal(reverted.title, '撤销授权 · context 携带');
  assert.equal(reverted.result, 'info');

  const unknown = await dispatch(engine, CMD.grantToggle, { grantId: 'g-unknown' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'SIMULATOR_INVALID_PAYLOAD');
});

test('pending grants resolve into session-scoped engine truth', async () => {
  const engine = createEngine();
  const accepted = await dispatch(engine, CMD.grantResolve, {
    grantId: 'g-journal-read',
    accept: true,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value, { grantId: 'g-journal-read', status: 'active' });
  let grant = productOf(engine).grants.find((entry) => entry.id === 'g-journal-read');
  assert.equal(grant.status, 'active');
  assert.equal(grant.receipt.validity, '本次会话');
  assert.equal(grant.receipt.expiry, '本次模拟会话结束时失效');
  assert.equal(productOf(engine).ledger.at(-1).title, '授权 · 心情日记读取');
  assert.equal(productOf(engine).ledger.at(-1).result, 'committed');

  const denied = await dispatch(engine, CMD.grantResolve, {
    grantId: 'g-footprint-weekly',
    accept: false,
  });
  assert.equal(denied.ok, true);
  assert.deepEqual(denied.value, { grantId: 'g-footprint-weekly', status: 'revoked' });
  grant = productOf(engine).grants.find((entry) => entry.id === 'g-footprint-weekly');
  assert.equal(grant.status, 'revoked');
  assert.equal(grant.receipt.expiry, '已撤销');
  assert.equal(productOf(engine).ledger.at(-1).result, 'denied');
});

test('Shell product projection rejects malformed nested grant state', () => {
  const product = structuredClone(productOf(createEngine()));
  product.grants[0].receipt.validity = '长期有效';
  assert.throws(
    () => parseShellProductState(product),
    /SIMULATOR_PRODUCT_STATE_INVALID/u,
  );
});

test('world.pin flow runs its declared steps to completion as engine truth', async () => {
  const engine = createEngine();
  const flow = SIMULATOR_PRODUCT_FLOWS['world.pin'];
  const begun = await dispatch(engine, CMD.flowBegin, { flowId: 'world.pin' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'world.pin', status: 'running' });
  // Step 0 is an engine-effect (agent) step: no directive is published.
  assert.equal(productOf(engine).flow.currentDirective, null);

  const legacyPayload = await dispatch(engine, CMD.flowStep, {});
  assert.equal(legacyPayload.ok, false);
  assert.equal(legacyPayload.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  const stalePosition = await dispatch(engine, CMD.flowStep, { flowId: 'world.pin', stepIndex: 1 });
  assert.equal(stalePosition.ok, false);
  assert.equal(stalePosition.error.code, 'SIMULATOR_INVALID_LIFECYCLE');

  for (let index = 0; index < flow.steps.length - 1; index += 1) {
    const stepped = await stepCurrentFlow(engine);
    assert.equal(stepped.ok, true, `step ${index}`);
    assert.equal(stepped.value.status, 'running');
  }
  const last = await stepCurrentFlow(engine);
  assert.equal(last.ok, true);
  assert.deepEqual(last.value, { flowId: 'world.pin', stepIndex: flow.steps.length, status: 'completed' });

  const product = productOf(engine);
  assert.deepEqual(product.agent, { status: 'observing', location: 'desktop', carry: null });
  const flowEntry = product.ledger.at(-1);
  assert.equal(flowEntry.kind, 'flow');
  assert.equal(flowEntry.title, '足迹 · 回声谷');
  assert.equal(flowEntry.result, 'committed');
  assert.equal(product.flow.status, 'completed');
  assert.equal(product.flow.currentDirective, null);

  const after = await stepCurrentFlow(engine);
  assert.equal(after.ok, false);
  assert.equal(after.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
});

test('revoked non-consentable grant blocks the flow with a typed unsupported ledger entry', async () => {
  const engine = createEngine();
  assert.equal((await dispatch(engine, CMD.grantToggle, { grantId: 'g-world-write' })).ok, true);
  const begun = await dispatch(engine, CMD.flowBegin, { flowId: 'world.pin' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'world.pin', status: 'blocked' });
  const product = productOf(engine);
  assert.equal(product.flow.status, 'blocked');
  const entry = product.ledger.at(-1);
  assert.equal(entry.result, 'unsupported');
  assert.equal(entry.kind, 'flow');
  assert.match(entry.title, /未提交/u);
  const stepped = await stepCurrentFlow(engine);
  assert.equal(stepped.ok, false);
  assert.equal(stepped.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
});

test('local-agent.project flow gates on the revoked grant through consent, and accept flips the grant', async () => {
  const engine = createEngine();
  const begun = await dispatch(engine, CMD.flowBegin, { flowId: 'local-agent.project' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'local-agent.project', status: 'awaiting-consent' });
  let product = productOf(engine);
  assert.deepEqual(product.consent, { flowId: 'local-agent.project', grantId: 'g-local-agent-context-projection', origin: 'desktop' });
  assert.equal(product.flow.status, 'awaiting-consent');

  const concurrent = await dispatch(engine, CMD.flowBegin, { flowId: 'world.pin' });
  assert.equal(concurrent.ok, false);
  assert.equal(concurrent.error.code, 'SIMULATOR_INVALID_LIFECYCLE');

  const resolved = await dispatch(engine, CMD.consentResolve, { accept: true });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, { accepted: true, flowId: 'local-agent.project', status: 'running' });
  product = productOf(engine);
  assert.equal(product.consent, null);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'active');
  assert.equal(product.flow.status, 'running');
  // Step 0 of local-agent.project is the request-interaction step: the directive is
  // published from engine truth in the initial commit.
  assert.deepEqual(product.flow.currentDirective, {
    name: 'request-interaction',
    interactionType: 'local-agent.context.project',
    commandType: 'desktop.context-projection.request',
    moduleId: 'zhiyu',
  });
  const entry = product.ledger.at(-1);
  assert.equal(entry.title, '重新授权 · context 携带');
  assert.equal(entry.result, 'committed');

  const flow = SIMULATOR_PRODUCT_FLOWS['local-agent.project'];
  for (let index = 0; index < flow.steps.length; index += 1) {
    assert.equal((await stepCurrentFlow(engine)).ok, true, `step ${index}`);
  }
  product = productOf(engine);
  assert.equal(product.flow.status, 'completed');
  assert.deepEqual(product.agent, { status: 'observing', location: 'zhiyu', carry: null });
});

test('flow.begin publishes the step-0 directive for directive-first flows', async () => {
  const engine = createEngine();
  // Activate the carry grant so begin takes the running path directly.
  assert.equal((await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' })).ok, true);
  const begun = await dispatch(engine, CMD.flowBegin, { flowId: 'local-agent.project' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'local-agent.project', status: 'running' });
  assert.deepEqual(productOf(engine).flow, {
    flowId: 'local-agent.project',
    stepIndex: 0,
    status: 'running',
    currentDirective: {
      name: 'request-interaction',
      interactionType: 'local-agent.context.project',
      commandType: 'desktop.context-projection.request',
      moduleId: 'zhiyu',
    },
  });
});

test('handoff flow publishes its request-interaction directive at step 1 like later steps', async () => {
  const engine = createEngine();
  const handoff = await dispatch(engine, CMD.flowBegin, { flowId: 'handoff.zhiyu' });
  assert.equal(handoff.ok, true);
  // Step 0 is an agent engine-effect step: no directive yet.
  assert.equal(productOf(engine).flow.currentDirective, null);
  assert.equal((await stepCurrentFlow(engine)).ok, true);
  assert.deepEqual(productOf(engine).flow.currentDirective, {
    name: 'request-interaction',
    interactionType: 'handoff.surface.commit',
    commandType: 'desktop.handoff.request',
    moduleId: 'zhiyu',
  });
});

test('flow.block commits typed failure truth and rejects stale async positions', async () => {
  const engine = createEngine();
  assert.equal((await dispatch(engine, CMD.flowBegin, { flowId: 'handoff.zhiyu' })).ok, true);
  const ledgerBefore = productOf(engine).ledger.length;

  const stale = await dispatch(engine, CMD.flowBlock, {
    flowId: 'handoff.zhiyu',
    stepIndex: 1,
    errorCode: 'SIMULATOR_INSTANCE_DISPOSED',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  assert.equal(productOf(engine).ledger.length, ledgerBefore);
  assert.equal(productOf(engine).flow.status, 'running');

  const blocked = await dispatch(engine, CMD.flowBlock, {
    flowId: 'handoff.zhiyu',
    stepIndex: 0,
    errorCode: 'SIMULATOR_INSTANCE_DISPOSED',
  });
  assert.equal(blocked.ok, true);
  assert.deepEqual(blocked.value, {
    flowId: 'handoff.zhiyu',
    stepIndex: 0,
    status: 'blocked',
    errorCode: 'SIMULATOR_INSTANCE_DISPOSED',
  });
  const product = productOf(engine);
  assert.deepEqual(product.flow, {
    flowId: 'handoff.zhiyu',
    stepIndex: 0,
    status: 'blocked',
    currentDirective: null,
  });
  const entry = product.ledger.at(-1);
  assert.equal(entry.kind, 'flow');
  assert.equal(entry.result, 'unsupported');
  assert.match(entry.detail, /SIMULATOR_INSTANCE_DISPOSED/u);
  assert.equal((await stepCurrentFlow(engine)).error.code, 'SIMULATOR_INVALID_LIFECYCLE');
});

test('consent deny commits a denied ledger entry and no grant flip', async () => {
  const engine = createEngine();
  assert.equal((await dispatch(engine, CMD.flowBegin, { flowId: 'local-agent.project' })).ok, true);
  const resolved = await dispatch(engine, CMD.consentResolve, { accept: false });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, { accepted: false, flowId: 'local-agent.project', status: 'denied' });
  const product = productOf(engine);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'revoked');
  const entry = product.ledger.at(-1);
  assert.equal(entry.kind, 'delegation');
  assert.equal(entry.result, 'denied');
  assert.match(entry.title, /授权被拒绝/u);
  assert.equal(product.flow.status, 'denied');

  const again = await dispatch(engine, CMD.consentResolve, { accept: true });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
});

test('persona commit and LocalAgent transition are declared commands with typed events', async () => {
  const engine = createEngine();
  const committed = await dispatch(engine, CMD.personaCommit, {
    name: '林澈',
    id: 'u_7f3a',
    role: '生态居民 · 早期体验者',
  });
  assert.equal(committed.ok, true);
  assert.deepEqual(productOf(engine).persona, {
    name: '林澈',
    id: 'u_7f3a',
    role: '生态居民 · 早期体验者',
  });
  const transitioned = await dispatch(engine, CMD.localAgentTransition, {
    status: 'migrating',
    location: 'desktop',
    carry: '回声谷解谜计划',
  });
  assert.equal(transitioned.ok, true);
  assert.deepEqual(productOf(engine).agent, {
    status: 'migrating',
    location: 'desktop',
    carry: '回声谷解谜计划',
  });
});

test('ledger append validates the closed kind/result unions', async () => {
  const engine = createEngine();
  const appended = await dispatch(engine, CMD.ledgerAppend, {
    kind: 'system',
    title: '模拟诊断',
    detail: '模拟：契约测试附加的诊断条目。',
    actors: ['系统'],
    tags: [],
    result: 'info',
  });
  assert.equal(appended.ok, true);
  assert.equal(appended.value.entryId, '1:op:013');

  const invalid = await dispatch(engine, CMD.ledgerAppend, {
    kind: 'retroactive',
    title: 'x',
    detail: 'y',
    actors: ['系统'],
    tags: [],
    result: 'info',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'SIMULATOR_INVALID_PAYLOAD');
});

test('product commands fail typed when the scenario does not seed product state', async () => {
  const engine = createSimulatorStateEngine({
    scenario: { ...scenarioOptions(), shellState: { readiness: {} } },
  });
  const result = await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_UNSUPPORTED');
});

test('scenario reset restores the seeded product state', async () => {
  const engine = createEngine();
  assert.equal((await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' })).ok, true);
  assert.equal((await dispatch(engine, CMD.flowBegin, { flowId: 'world.pin' })).ok, true);
  assert.notEqual(productOf(engine).grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'revoked');

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO);
  assert.equal(reset.ok, true);
  const product = productOf(engine);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'revoked');
  assert.equal(product.ledger.length, 6);
  assert.equal(product.opSeq, 12);
  assert.deepEqual(product.flow, { flowId: null, stepIndex: 0, status: 'idle', currentDirective: null });
  assert.equal(product.persona, null);
});

test('product command sequences are deterministic across fresh engines', async () => {
  const run = async () => {
    const engine = createEngine();
    await dispatch(engine, CMD.grantToggle, { grantId: 'g-local-agent-context-projection' });
    await dispatch(engine, CMD.flowBegin, { flowId: 'world.pin' });
    for (let index = 0; index < SIMULATOR_PRODUCT_FLOWS['world.pin'].steps.length; index += 1) {
      await stepCurrentFlow(engine);
    }
    await dispatch(engine, CMD.personaCommit, { name: '林澈', id: 'u_7f3a', role: '生态居民 · 早期体验者' });
    return productOf(engine);
  };
  const first = await run();
  const second = await run();
  assert.deepEqual(second, first);
});
