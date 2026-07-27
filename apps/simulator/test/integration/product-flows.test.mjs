import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { simulatorReferenceInteractionCatalog } from '../../src/interactions/reference-ecosystem.ts';
import { validateSimulatorScenario } from '../../build/config.mjs';
import { desktopSimulatorBehavior } from '../../../desktop/src/simulator/behavior.ts';
import { simulatorConformanceFixture as desktopFixture } from '../../../desktop/src/simulator/fixture.ts';
import { testerSimulatorBehavior } from '../../../tester/src/simulator/behavior.ts';
import { simulatorConformanceFixture as testerFixture } from '../../../tester/src/simulator/fixture.ts';
import { zhiyuSimulatorBehavior } from '../../../zhiyu/src/simulator/behavior.ts';
import { simulatorConformanceFixture as zhiyuFixture } from '../../../zhiyu/src/simulator/fixture.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHELL = { kind: 'shell', moduleId: null, instanceId: null };

const MODULES = [
  { moduleId: 'desktop', orderingKey: 0, fixture: desktopFixture, behavior: desktopSimulatorBehavior },
  { moduleId: 'tester', orderingKey: 1, fixture: testerFixture, behavior: testerSimulatorBehavior },
  { moduleId: 'zhiyu', orderingKey: 2, fixture: zhiyuFixture, behavior: zhiyuSimulatorBehavior },
];

const validated = validateSimulatorScenario(parse(
  readFileSync(path.join(REPO_ROOT, 'config/simulator/scenario.yaml'), 'utf8'),
));

const SCENARIO = {
  scenarioId: validated.scenario_id,
  scenarioRevision: validated.scenario_revision,
  seed: validated.seed,
  initialLogicalTime: validated.initial_logical_time,
  scenarioState: validated.state.scenario,
  ecosystemState: validated.state.ecosystem,
  shellState: validated.state.shell,
};

async function transition(engine, instanceId, name) {
  const result = await engine.acceptCommand('simulator.instance.transition', { instanceId, transition: name }, SHELL);
  assert.equal(result.ok, true, `${instanceId} ${name}`);
}

async function createIntegratedEngine(options = {}) {
  const engine = createSimulatorStateEngine({ scenario: SCENARIO, interactions: simulatorReferenceInteractionCatalog });
  for (const module of MODULES) {
    engine.registerModuleCatalog({
      moduleId: module.moduleId,
      orderingKey: module.orderingKey,
      commandSchemas: module.fixture.catalog.commandSchemas,
      eventSchemas: module.fixture.catalog.eventSchemas,
      queries: {},
      selectSharedProjection: null,
      moduleData: module.fixture.catalog.moduleData,
    });
  }
  for (const module of MODULES) {
    assert.deepEqual(engine.attachModuleBehavior(module.moduleId, module.behavior), { ok: true, value: { attached: true } });
    const activated = await engine.acceptCommand('simulator.behavior.activate', { moduleId: module.moduleId }, SHELL);
    assert.equal(activated.ok, true);
  }
  const instanceIds = {};
  for (const module of MODULES) {
    if (options.omitModule === module.moduleId) continue;
    const opened = await engine.acceptCommand('simulator.instance.open', {
      moduleId: module.moduleId,
      surfaceId: 'main',
      initialRoute: { pathname: module.moduleId === 'desktop' ? '/login' : '/', search: [], fragment: null },
    }, SHELL);
    assert.equal(opened.ok, true);
    const instanceId = opened.value.instanceId;
    instanceIds[module.moduleId] = instanceId;
    await transition(engine, instanceId, 'module_loaded');
    await transition(engine, instanceId, 'prepare_success');
    await transition(engine, instanceId, 'activate');
  }
  return { engine, instanceIds };
}

function shellProduct(engine) {
  return engine.getCommitted().partitions.shell.product;
}

function interactionEnvelope(instanceId, type, payload, targets) {
  return {
    protocol: 'nimi.simulator.interaction/v1',
    interactionId: `${instanceId}:test:${type}`,
    source: { moduleId: 'desktop', instanceId },
    targets,
    type,
    payload,
  };
}

const PERSONA = {
  accountId: 'sim-account-linche',
  userId: 'sim-user-linche',
  displayName: '林澈',
  role: '生态居民 · 早期体验者',
  realmEnvironmentId: 'sim-realm-env-desktop',
};

test('session.persona.share commits the persona to ecosystem, shell product, and target modules', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const beforeRevision = engine.getCommitted().revision;
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'session.persona.share', PERSONA, ['zhiyu', 'tester']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.ecosystemRevision, beforeRevision + 1);
  // One atomic ecosystem+product commit plus one commit per target stage.
  assert.equal(engine.getCommitted().revision, beforeRevision + 3);

  const ecosystem = engine.getCommitted().partitions.ecosystem;
  assert.equal(ecosystem.persona.persona.displayName, '林澈');

  const product = shellProduct(engine);
  assert.deepEqual(product.persona, {
    name: '林澈',
    id: 'sim-user-linche',
    role: '生态居民 · 早期体验者',
  });
  const entry = product.ledger.at(-1);
  assert.equal(entry.kind, 'delegation');
  assert.match(entry.title, /身份共享 · 林澈/u);
  assert.match(entry.detail, /模拟/u);
  assert.equal(entry.result, 'committed');

  const zhiyu = engine.projectInstance(instanceIds.zhiyu);
  const tester = engine.projectInstance(instanceIds.tester);
  assert.equal(zhiyu.ok, true);
  assert.equal(tester.ok, true);
  assert.equal(zhiyu.value.personaReference.persona.displayName, '林澈');
  assert.equal(tester.value.personaReference.persona.displayName, '林澈');
  assert.equal(zhiyu.value.personaReference.persona.accountId, 'sim-account-linche');
  // The ecosystem reference projection stays untouched.
  assert.equal(zhiyu.value.ecosystemReference, null);
  assert.equal(tester.value.ecosystemReference, null);

  const committedRevision = engine.getCommitted().revision;
  const duplicate = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'session.persona.share', PERSONA, ['zhiyu', 'tester']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.value.idempotent, true);
  assert.equal(engine.getCommitted().revision, committedRevision);
});

test('handoff.surface routes the target surfaces and posts the ledger entry atomically', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const route = {
    pathname: '/',
    search: [{ key: 'handoff', value: 'sim-intent-handoff' }],
    fragment: null,
  };
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'handoff.surface.commit', {
      targetSurfaceId: 'main',
      route,
      card: { title: '在织语中继续', detail: '模拟交接卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);

  const zhiyuInstance = engine.getCommitted().instance(instanceIds.zhiyu);
  assert.deepEqual(zhiyuInstance.route, route);
  const desktopInstance = engine.getCommitted().instance(instanceIds.desktop);
  assert.equal(desktopInstance.route.pathname, '/login');

  const zhiyu = engine.projectInstance(instanceIds.zhiyu);
  assert.equal(zhiyu.value.handoff.card.title, '在织语中继续');
  assert.deepEqual(zhiyu.value.handoff.route, route);

  const entry = shellProduct(engine).ledger.at(-1);
  assert.equal(entry.kind, 'flow');
  assert.match(entry.title, /意图交接/u);
  assert.match(entry.detail, /模拟/u);

  const ecosystem = engine.getCommitted().partitions.ecosystem;
  assert.equal(ecosystem.handoff.card.title, '在织语中继续');
});

test('agent.context.carry delivers the carry payload, route, and both ledger entries', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'agent.context.carry', {
      carry: '回声谷解谜计划',
      card: { title: '会话摘要', detail: '模拟摘要卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);

  const zhiyuInstance = engine.getCommitted().instance(instanceIds.zhiyu);
  assert.deepEqual(zhiyuInstance.route, {
    pathname: '/',
    search: [{ key: 'carry', value: 'sim-context-carry' }],
    fragment: null,
  });
  const zhiyu = engine.projectInstance(instanceIds.zhiyu);
  assert.equal(zhiyu.value.carry.carry, '回声谷解谜计划');
  assert.equal(zhiyu.value.carry.card.title, '会话摘要');

  const ledger = shellProduct(engine).ledger.slice(-2);
  assert.deepEqual(ledger.map((entry) => entry.kind), ['delegation', 'agent-action']);
  assert.match(ledger[0].title, /委托 · 携带会话摘要/u);
  assert.match(ledger[1].title, /agent 行动 · 摘要投递/u);
  assert.match(ledger[0].detail + ledger[1].detail, /模拟/u);

  const ecosystem = engine.getCommitted().partitions.ecosystem;
  assert.equal(ecosystem.carry.carry, '回声谷解谜计划');
});

test('agent.carry consent accept publishes the step-0 request-interaction directive from engine truth', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  void instanceIds;
  const begun = await engine.acceptCommand(
    'simulator.product.flow.begin',
    { flowId: 'agent.carry' },
    SHELL,
  );
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'agent.carry', status: 'awaiting-consent' });
  assert.equal(shellProduct(engine).flow.currentDirective, null);

  const resolved = await engine.acceptCommand(
    'simulator.product.consent.resolve',
    { accept: true },
    SHELL,
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, { accepted: true, flowId: 'agent.carry', status: 'running' });
  const flow = shellProduct(engine).flow;
  assert.equal(flow.stepIndex, 0);
  assert.deepEqual(flow.currentDirective, {
    name: 'request-interaction',
    interactionType: 'agent.context.carry',
    commandType: 'desktop.carry.request',
    moduleId: 'zhiyu',
  });
});

test('product interactions fail typed with no state commit when a target is missing', async () => {
  const { engine, instanceIds } = await createIntegratedEngine({ omitModule: 'zhiyu' });
  const beforeRevision = engine.getCommitted().revision;
  const productBefore = shellProduct(engine);
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'handoff.surface.commit', {
      targetSurfaceId: 'main',
      route: { pathname: '/', search: [], fragment: null },
      card: { title: '在织语中继续', detail: '模拟交接卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(engine.getCommitted().revision, beforeRevision);
  assert.equal(shellProduct(engine), productBefore);
});

/* — Shell product runner sequence behavior —
 * These mirror the Shell chrome provider's dispatch loop
 * (src/shell/chrome/product-presentation.tsx): `simulator.product.flow.begin`
 * → consent gating → fixed-step `simulator.product.flow.step` ticks, emitting
 * the typed cross-app interaction envelope exactly when the engine publishes
 * a `request-interaction` directive. */

const SHELL_ISSUER = SHELL;

function shellDispatch(engine, type, payload) {
  return engine.acceptCommand(type, payload, SHELL_ISSUER);
}

async function runShellRunnerToTerminal(engine, originInstanceId, { maxTicks = 24 } = {}) {
  const seenDirectives = [];
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const product = shellProduct(engine);
    const flow = product.flow;
    if (flow.status !== 'running') return { status: flow.status, seenDirectives };
    // Engine truth: currentDirective is published for every step, step 0
    // included (begin/resolve commit stepDirective(flow, 0)).
    const directive = flow.currentDirective;
    seenDirectives.push(directive?.name ?? null);
    if (directive?.name === 'request-interaction') {
      const emitted = await engine.acceptCommand(
        'simulator.interaction.emit',
        interactionEnvelope(originInstanceId, directive.interactionType, {
          carry: '回声谷解谜计划',
          card: { title: '来自基座 agent · 会话摘要', detail: '模拟摘要卡片' },
        }, [directive.moduleId]),
        { kind: 'instance', moduleId: 'desktop', instanceId: originInstanceId },
      );
      assert.equal(emitted.ok, true, `interaction emit at step ${flow.stepIndex}`);
    }
    const stepped = await shellDispatch(engine, 'simulator.product.flow.step', {});
    assert.equal(stepped.ok, true, `flow.step at tick ${tick}`);
  }
  return { status: shellProduct(engine).flow.status, seenDirectives };
}

test('shell runner: agent.carry gates on consent, steps to completion, and settles the agent', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const product = shellProduct(engine);
  assert.equal(product.grants.find((grant) => grant.id === 'g-context-carry').status, 'revoked');

  const begun = await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'agent.carry' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'agent.carry', status: 'awaiting-consent' });
  assert.deepEqual(shellProduct(engine).consent, {
    flowId: 'agent.carry',
    grantId: 'g-context-carry',
    origin: 'desktop',
  });

  const resolved = await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: true });
  assert.equal(resolved.ok, true);
  assert.equal(shellProduct(engine).consent, null);
  assert.equal(shellProduct(engine).grants.find((grant) => grant.id === 'g-context-carry').status, 'active');
  assert.equal(shellProduct(engine).ledger.at(-1).title, '重新授权 · context 携带');

  const { status, seenDirectives } = await runShellRunnerToTerminal(engine, instanceIds.desktop);
  assert.equal(status, 'completed');
  assert.ok(seenDirectives.includes('request-interaction'));
  assert.ok(seenDirectives.includes('bridge-measure'));
  assert.ok(seenDirectives.includes('bridge-to-target'));
  assert.ok(seenDirectives.includes('bridge-done'));
  assert.ok(seenDirectives.includes('focus-app'));
  assert.ok(seenDirectives.includes('toast'));

  const finalProduct = shellProduct(engine);
  const carryEntries = finalProduct.ledger.slice(-2);
  assert.deepEqual(carryEntries.map((entry) => entry.kind), ['delegation', 'agent-action']);
  assert.match(carryEntries[0].title, /委托 · 携带会话摘要/u);
  assert.match(carryEntries[1].title, /agent 行动 · 摘要投递/u);
  assert.deepEqual(finalProduct.agent, { status: 'observing', location: 'zhiyu', carry: null });

  const zhiyuInstance = engine.getCommitted().instance(instanceIds.zhiyu);
  assert.deepEqual(zhiyuInstance.route, {
    pathname: '/',
    search: [{ key: 'carry', value: 'sim-context-carry' }],
    fragment: null,
  });
});

test('shell runner: consent deny commits a denied entry, no grant flip, and no carry', async () => {
  const { engine } = await createIntegratedEngine();
  const ledgerBefore = shellProduct(engine).ledger.length;

  const begun = await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'agent.carry' });
  assert.equal(begun.ok, true);
  const resolved = await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: false });
  assert.equal(resolved.ok, true);

  const product = shellProduct(engine);
  assert.equal(product.flow.status, 'denied');
  assert.equal(product.consent, null);
  assert.equal(product.grants.find((grant) => grant.id === 'g-context-carry').status, 'revoked');
  assert.equal(product.ledger.length, ledgerBefore + 1);
  const denied = product.ledger.at(-1);
  assert.equal(denied.kind, 'delegation');
  assert.equal(denied.result, 'denied');
  assert.match(denied.title, /授权被拒绝/u);
  assert.equal(engine.getCommitted().partitions.ecosystem.carry, undefined);
});

test('shell runner: grant.toggle appends the delegation ledger entry the drawer renders', async () => {
  const { engine } = await createIntegratedEngine();
  const toggled = await shellDispatch(engine, 'simulator.product.grant.toggle', { grantId: 'g-presence-read' });
  assert.equal(toggled.ok, true);
  assert.deepEqual(toggled.value, { grantId: 'g-presence-read', status: 'revoked' });

  const product = shellProduct(engine);
  const entry = product.ledger.at(-1);
  assert.equal(entry.kind, 'delegation');
  assert.equal(entry.result, 'info');
  assert.match(entry.title, /撤销授权 · 在场状态读取/u);
  assert.equal(product.grants.find((grant) => grant.id === 'g-presence-read').status, 'revoked');
});

test('shell runner: scenario reset restores the seeded product state for the next epoch', async () => {
  const { engine } = await createIntegratedEngine();
  const seeded = shellProduct(engine);
  await shellDispatch(engine, 'simulator.product.grant.toggle', { grantId: 'g-world-write' });
  await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'agent.carry' });
  assert.notDeepEqual(shellProduct(engine).ledger, seeded.ledger);

  const reset = await engine.acceptCommand('simulator.reset', {}, {
    kind: 'scenario',
    moduleId: null,
    instanceId: null,
  });
  assert.equal(reset.ok, true);

  const restored = shellProduct(engine);
  assert.equal(engine.epoch, seeded === null ? 2 : 2);
  assert.deepEqual(
    restored.grants.map((grant) => [grant.id, grant.status]),
    seeded.grants.map((grant) => [grant.id, grant.status]),
  );
  assert.equal(restored.ledger.length, seeded.ledger.length);
  assert.equal(restored.flow.status, 'idle');
  assert.equal(restored.consent, null);
  assert.deepEqual(restored.agent, seeded.agent);
  assert.equal(restored.persona, null);
});
