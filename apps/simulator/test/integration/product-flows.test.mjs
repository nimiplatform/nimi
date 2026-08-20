import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { simulatorOk } from '../../src/state-engine/errors.ts';
import { simulatorReferenceInteractionCatalog } from '../../src/interactions/reference-ecosystem.ts';
import {
  advancePresentationFlow,
  emitPresentationInteraction,
} from '../../src/shell/chrome/product-presentation.tsx';
import { validateSimulatorScenario } from '../../build/config.mjs';
import { desktopSimulatorBehavior } from '../../../desktop/src/simulator/behavior.ts';
import { simulatorConformanceFixture as desktopFixture } from '../../../desktop/src/simulator/fixture.ts';
import { labSimulatorBehavior } from '../../../lab/src/simulator/behavior.ts';
import { simulatorConformanceFixture as labFixture } from '../../../lab/src/simulator/fixture.ts';
import { zhiyuSimulatorBehavior } from '../../../zhiyu/src/simulator/behavior.ts';
import { simulatorConformanceFixture as zhiyuFixture } from '../../../zhiyu/src/simulator/fixture.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHELL = { kind: 'shell', moduleId: null, instanceId: null };

const MODULES = [
  { moduleId: 'desktop', orderingKey: 0, fixture: desktopFixture, behavior: desktopSimulatorBehavior },
  { moduleId: 'lab', orderingKey: 1, fixture: labFixture, behavior: labSimulatorBehavior },
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
    interactionEnvelope(instanceIds.desktop, 'session.persona.share', PERSONA, ['zhiyu', 'lab']),
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
  const lab = engine.projectInstance(instanceIds.lab);
  assert.equal(zhiyu.ok, true);
  assert.equal(lab.ok, true);
  assert.equal(zhiyu.value.personaReference.persona.displayName, '林澈');
  assert.equal(lab.value.personaReference.persona.displayName, '林澈');
  assert.equal(zhiyu.value.personaReference.persona.accountId, 'sim-account-linche');
  // The ecosystem reference projection stays untouched.
  assert.equal(zhiyu.value.ecosystemReference, null);
  assert.equal(lab.value.ecosystemReference, null);

  const committedRevision = engine.getCommitted().revision;
  const duplicate = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'session.persona.share', PERSONA, ['zhiyu', 'lab']),
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
      card: { title: '在织羽中继续', detail: '模拟交接卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);

  const zhiyuInstance = engine.getCommitted().instance(instanceIds.zhiyu);
  assert.deepEqual(zhiyuInstance.route, route);
  const desktopInstance = engine.getCommitted().instance(instanceIds.desktop);
  assert.equal(desktopInstance.route.pathname, '/login');

  const zhiyu = engine.projectInstance(instanceIds.zhiyu);
  assert.equal(zhiyu.value.handoff.card.title, '在织羽中继续');
  assert.deepEqual(zhiyu.value.handoff.route, route);

  const entry = shellProduct(engine).ledger.at(-1);
  assert.equal(entry.kind, 'flow');
  assert.match(entry.title, /意图交接/u);
  assert.match(entry.detail, /模拟/u);

  const ecosystem = engine.getCommitted().partitions.ecosystem;
  assert.equal(ecosystem.handoff.card.title, '在织羽中继续');
});

test('local-agent.context.project delivers the carry payload, route, and both ledger entries', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    interactionEnvelope(instanceIds.desktop, 'local-agent.context.project', {
      carry: '回声谷解谜计划',
      card: { title: '会话摘要', detail: '模拟摘要卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);

  const zhiyuInstance = engine.getCommitted().instance(instanceIds.zhiyu);
  assert.deepEqual(zhiyuInstance.route, {
    pathname: '/',
    search: [{ key: 'carry', value: 'sim-local-agent-context-projection' }],
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

test('local-agent.project consent accept publishes the step-0 request-interaction directive from engine truth', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  void instanceIds;
  const begun = await engine.acceptCommand(
    'simulator.product.flow.begin',
    { flowId: 'local-agent.project' },
    SHELL,
  );
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'local-agent.project', status: 'awaiting-consent' });
  assert.equal(shellProduct(engine).flow.currentDirective, null);

  const resolved = await engine.acceptCommand(
    'simulator.product.consent.resolve',
    { accept: true },
    SHELL,
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, { accepted: true, flowId: 'local-agent.project', status: 'running' });
  const flow = shellProduct(engine).flow;
  assert.equal(flow.stepIndex, 0);
  assert.deepEqual(flow.currentDirective, {
    name: 'request-interaction',
    interactionType: 'local-agent.context.project',
    commandType: 'desktop.context-projection.request',
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
      card: { title: '在织羽中继续', detail: '模拟交接卡片' },
    }, ['zhiyu']),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(engine.getCommitted().revision, beforeRevision);
  assert.equal(shellProduct(engine), productBefore);
});

/* — Shell product runner sequence behavior —
 * These execute the production presentation runner against a real integrated
 * State Engine. The only substituted work is DOM-only animation directives;
 * request-interaction directives use the production envelope builder and
 * actual module behaviors. */

const SHELL_ISSUER = SHELL;

function shellDispatch(engine, type, payload) {
  return engine.acceptCommand(type, payload, SHELL_ISSUER);
}

const PRESENTATION_MODULES = MODULES.map((module) => ({
  moduleId: module.moduleId,
  surfaces: [{ id: 'main' }],
}));

function presentationInstances(engine, instanceIds) {
  return Object.values(instanceIds).map((instanceId) => {
    const instance = engine.getCommitted().instance(instanceId);
    return {
      instanceId,
      moduleId: instance.moduleId,
      status: instance.status,
    };
  });
}

function presentationInteractionPort(engine) {
  return (input) => engine.acceptCommand('simulator.interaction.emit', {
    protocol: 'nimi.simulator.interaction/v1',
    interactionId: input.interactionId,
    source: { moduleId: input.sourceModuleId, instanceId: input.sourceInstanceId },
    targets: [...input.targets],
    type: input.type,
    payload: input.payload,
  }, {
    kind: 'instance',
    moduleId: input.sourceModuleId,
    instanceId: input.sourceInstanceId,
  });
}

function runPublishedDirective(engine, instanceIds, flow, directive) {
  if (!directive) return Promise.resolve(simulatorOk({ directive: null }));
  if (directive.name !== 'request-interaction') {
    return Promise.resolve(simulatorOk({ directive: directive.name }));
  }
  return emitPresentationInteraction({
    directive,
    flowId: flow.flowId,
    stepIndex: flow.stepIndex,
    instances: presentationInstances(engine, instanceIds),
    modules: PRESENTATION_MODULES,
    emitInteraction: presentationInteractionPort(engine),
  });
}

function advanceShellRunnerTick(engine, instanceIds) {
  const flow = shellProduct(engine).flow;
  const directive = flow.currentDirective;
  return advancePresentationFlow({
    flowId: flow.flowId,
    stepIndex: flow.stepIndex,
    runDirective: () => runPublishedDirective(engine, instanceIds, flow, directive),
    dispatchProductCommand: (type, payload) => shellDispatch(engine, type, payload),
  });
}

async function runShellRunnerToTerminal(engine, instanceIds, { maxTicks = 24 } = {}) {
  const seenDirectives = [];
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const product = shellProduct(engine);
    const flow = product.flow;
    if (flow.status !== 'running') return { status: flow.status, seenDirectives };
    // Engine truth: currentDirective is published for every step, step 0
    // included (begin/resolve commit stepDirective(flow, 0)).
    const directive = flow.currentDirective;
    seenDirectives.push(directive?.name ?? null);
    const outcome = await advanceShellRunnerTick(engine, instanceIds);
    assert.equal(outcome.directive.ok, true, `directive at tick ${tick}`);
    assert.equal(outcome.progression?.ok, true, `flow.step at tick ${tick}`);
    assert.equal(outcome.settlement.ok, true, `flow settlement at tick ${tick}`);
  }
  return { status: shellProduct(engine).flow.status, seenDirectives };
}

test('shell runner: local-agent.project gates on consent, steps to completion, and settles the LocalAgent projection', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const product = shellProduct(engine);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'revoked');

  const begun = await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'local-agent.project' });
  assert.equal(begun.ok, true);
  assert.deepEqual(begun.value, { flowId: 'local-agent.project', status: 'awaiting-consent' });
  assert.deepEqual(shellProduct(engine).consent, {
    flowId: 'local-agent.project',
    grantId: 'g-local-agent-context-projection',
    origin: 'desktop',
  });

  const resolved = await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: true });
  assert.equal(resolved.ok, true);
  assert.equal(shellProduct(engine).consent, null);
  assert.equal(shellProduct(engine).grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'active');
  assert.equal(shellProduct(engine).ledger.at(-1).title, '重新授权 · context 携带');

  const { status, seenDirectives } = await runShellRunnerToTerminal(engine, instanceIds);
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
    search: [{ key: 'carry', value: 'sim-local-agent-context-projection' }],
    fragment: null,
  });
});

test('shell runner: a missing Desktop origin commits blocked State Engine truth without advancing', async () => {
  const { engine, instanceIds } = await createIntegratedEngine({ omitModule: 'desktop' });
  assert.equal((await shellDispatch(engine, 'simulator.product.flow.begin', {
    flowId: 'local-agent.project',
  })).ok, true);
  assert.equal((await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: true })).ok, true);
  const ledgerBefore = shellProduct(engine).ledger.length;

  const outcome = await advanceShellRunnerTick(engine, instanceIds);
  assert.equal(outcome.directive.ok, false);
  assert.equal(outcome.directive.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(outcome.progression, null);
  assert.equal(outcome.settlement.ok, true);
  assert.deepEqual(outcome.settlement.value, {
    flowId: 'local-agent.project',
    stepIndex: 0,
    status: 'blocked',
    errorCode: 'SIMULATOR_INSTANCE_DISPOSED',
  });

  const product = shellProduct(engine);
  assert.deepEqual(product.flow, {
    flowId: 'local-agent.project',
    stepIndex: 0,
    status: 'blocked',
    currentDirective: null,
  });
  assert.equal(product.ledger.length, ledgerBefore + 1);
  assert.equal(product.ledger.at(-1).result, 'unsupported');
  assert.match(product.ledger.at(-1).detail, /SIMULATOR_INSTANCE_DISPOSED/u);
  assert.deepEqual(product.agent, { status: 'idle', location: 'cradle', carry: null });
});

test('shell runner: an interaction target failure commits blocked truth instead of pseudo-success', async () => {
  const { engine, instanceIds } = await createIntegratedEngine({ omitModule: 'zhiyu' });
  assert.equal((await shellDispatch(engine, 'simulator.product.flow.begin', {
    flowId: 'local-agent.project',
  })).ok, true);
  assert.equal((await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: true })).ok, true);
  const revisionBefore = engine.getCommitted().revision;

  const outcome = await advanceShellRunnerTick(engine, instanceIds);
  assert.equal(outcome.directive.ok, false);
  assert.equal(outcome.directive.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(outcome.progression, null);
  assert.equal(outcome.settlement.ok, true);
  assert.equal(engine.getCommitted().revision, revisionBefore + 1);
  assert.equal(shellProduct(engine).flow.status, 'blocked');
  assert.equal(shellProduct(engine).flow.stepIndex, 0);
  assert.match(shellProduct(engine).ledger.at(-1).detail, /SIMULATOR_INSTANCE_DISPOSED/u);

  const after = await shellDispatch(engine, 'simulator.product.flow.step', {
    flowId: 'local-agent.project',
    stepIndex: 0,
  });
  assert.equal(after.ok, false);
  assert.equal(after.error.code, 'SIMULATOR_INVALID_LIFECYCLE');
});

test('shell runner: consent deny commits a denied entry, no grant flip, and no carry', async () => {
  const { engine } = await createIntegratedEngine();
  const ledgerBefore = shellProduct(engine).ledger.length;

  const begun = await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'local-agent.project' });
  assert.equal(begun.ok, true);
  const resolved = await shellDispatch(engine, 'simulator.product.consent.resolve', { accept: false });
  assert.equal(resolved.ok, true);

  const product = shellProduct(engine);
  assert.equal(product.flow.status, 'denied');
  assert.equal(product.consent, null);
  assert.equal(product.grants.find((grant) => grant.id === 'g-local-agent-context-projection').status, 'revoked');
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
  await shellDispatch(engine, 'simulator.product.flow.begin', { flowId: 'local-agent.project' });
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
