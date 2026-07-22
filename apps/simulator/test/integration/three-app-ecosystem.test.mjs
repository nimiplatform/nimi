import assert from 'node:assert/strict';
import test from 'node:test';

import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { replaySimulatorSession } from '../../src/state-engine/replay.ts';
import { simulatorReferenceInteractionCatalog } from '../../src/interactions/reference-ecosystem.ts';
import { desktopSimulatorBehavior } from '../../../desktop/src/simulator/behavior.ts';
import { simulatorConformanceFixture as desktopFixture } from '../../../desktop/src/simulator/fixture.ts';
import { testerSimulatorBehavior } from '../../../tester/src/simulator/behavior.ts';
import { simulatorConformanceFixture as testerFixture } from '../../../tester/src/simulator/fixture.ts';
import { zhiyuSimulatorBehavior } from '../../../zhiyu/src/simulator/behavior.ts';
import { simulatorConformanceFixture as zhiyuFixture } from '../../../zhiyu/src/simulator/fixture.ts';

const MODULES = [
  { moduleId: 'desktop', orderingKey: 0, fixture: desktopFixture, behavior: desktopSimulatorBehavior },
  { moduleId: 'tester', orderingKey: 1, fixture: testerFixture, behavior: testerSimulatorBehavior },
  { moduleId: 'zhiyu', orderingKey: 2, fixture: zhiyuFixture, behavior: zhiyuSimulatorBehavior },
];
const SCENARIO = {
  scenarioId: 'nimi-ecosystem',
  scenarioRevision: 'cp6',
  seed: 'e5'.repeat(32),
  initialLogicalTime: 0,
  scenarioState: { disclosure: 'simulated' },
  ecosystemState: { reference: null },
  shellState: { readiness: {} },
};
const SHELL = { kind: 'shell', moduleId: null, instanceId: null };
const MODULE_DEFINITIONS = MODULES.map((module) => ({
  moduleId: module.moduleId,
  orderingKey: module.orderingKey,
  commandSchemas: module.fixture.catalog.commandSchemas,
  eventSchemas: module.fixture.catalog.eventSchemas,
  queries: {},
  selectSharedProjection: null,
  moduleData: module.fixture.catalog.moduleData,
  behavior: module.behavior,
}));

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
    const behavior = options.behaviors?.[module.moduleId] ?? module.behavior;
    assert.deepEqual(engine.attachModuleBehavior(module.moduleId, behavior), { ok: true, value: { attached: true } });
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

function referenceEnvelope(instanceId, overrides = {}) {
  return {
    protocol: 'nimi.simulator.interaction/v1',
    interactionId: `${instanceId}:ecosystem:1`,
    source: { moduleId: 'desktop', instanceId },
    targets: ['zhiyu', 'tester'],
    type: 'ecosystem.reference.checkpoint',
    payload: { checkpointId: 'desktop-auth-primary', label: 'Desktop login action committed' },
    ...overrides,
  };
}

async function runReferenceInteraction() {
  const { engine, instanceIds } = await createIntegratedEngine();
  const beforeRevision = engine.getCommitted().revision;
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(instanceIds.desktop),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.ecosystemRevision, beforeRevision + 1);
  assert.equal(engine.getCommitted().revision, beforeRevision + 3);
  const zhiyu = engine.projectInstance(instanceIds.zhiyu);
  const tester = engine.projectInstance(instanceIds.tester);
  assert.equal(zhiyu.ok, true);
  assert.equal(tester.ok, true);
  assert.equal(zhiyu.value.ecosystemReference.ecosystemRevision, result.value.ecosystemRevision);
  assert.equal(tester.value.ecosystemReference.ecosystemRevision, result.value.ecosystemRevision);
  const replay = engine.buildReplayRecord();
  assert.deepEqual(
    replay.expected.revision,
    beforeRevision + 3,
  );
  return {
    result: result.value,
    replay,
    replayDigest: engine.replayRecordDigest(replay),
    eventDigest: replay.expected.eventDigest,
    stateDigest: replay.expected.stateDigest,
  };
}

test('Desktop interaction commits its ecosystem transaction before ordered Zhiyu and Tester stages', async () => {
  const first = await runReferenceInteraction();
  assert.equal(first.replay.expected.revision, first.result.ecosystemRevision + 2);
  assert.equal(first.replay.inputs.at(-1).operation.type, 'simulator.interaction.emit');
  assert.equal(first.replay.operationSettlements.at(-1).result.ok, true);
  assert.deepEqual(Object.keys(first.result).sort(), ['ecosystemRevision', 'eventId', 'interactionId']);
});

test('an unrelated same-type Zhiyu event cannot advance the interaction continuation', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  let inserted = false;
  const unsubscribe = engine.subscribeState(() => {
    const ecosystem = engine.getCommitted().partitions.ecosystem;
    const reference = ecosystem && typeof ecosystem === 'object' && !Array.isArray(ecosystem)
      ? ecosystem.reference
      : null;
    if (inserted || !reference || typeof reference !== 'object' || Array.isArray(reference)) return;
    inserted = true;
    void engine.acceptCommand('zhiyu.ecosystem.project', {
      ...reference,
      label: 'Unrelated same-type event',
    }, SHELL);
  });
  const result = await engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(instanceIds.desktop),
    { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
  );
  unsubscribe();
  assert.equal(result.ok, true);
  assert.equal(inserted, true);
  const tester = engine.projectInstance(instanceIds.tester);
  assert.equal(tester.ok, true);
  assert.equal(tester.value.ecosystemReference.label, 'Desktop login action committed');
});

test('reference interaction revision, event, state, and replay digests reproduce byte-identically', async () => {
  const expected = await runReferenceInteraction();
  for (let index = 0; index < 100; index += 1) {
    const replayed = await replaySimulatorSession(expected.replay, {
      scenario: SCENARIO,
      modules: MODULE_DEFINITIONS,
      interactions: simulatorReferenceInteractionCatalog,
    });
    assert.equal(replayed.matches, true);
    assert.equal(replayed.recomputed.eventDigest, expected.eventDigest);
    assert.equal(replayed.recomputed.stateDigest, expected.stateDigest);
    assert.equal(replayed.engine.replayRecordDigest(), expected.replayDigest);
  }
});

test('missing or closed targets fail deterministically without state or event changes', async () => {
  const missing = await createIntegratedEngine({ omitModule: 'zhiyu' });
  const before = missing.engine.buildReplayRecord().expected;
  const result = await missing.engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(missing.instanceIds.desktop),
    { kind: 'instance', moduleId: 'desktop', instanceId: missing.instanceIds.desktop },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  const after = missing.engine.buildReplayRecord().expected;
  assert.equal(after.revision, before.revision);
  assert.equal(after.stateDigest, before.stateDigest);
  assert.equal(after.eventDigest, before.eventDigest);

  const closed = await createIntegratedEngine();
  await transition(closed.engine, closed.instanceIds.zhiyu, 'dispose');
  const disposed = await closed.engine.acceptCommand(
    'simulator.instance.disposed',
    { instanceId: closed.instanceIds.zhiyu },
    SHELL,
  );
  assert.equal(disposed.ok, true);
  const closedRevision = closed.engine.getCommitted().revision;
  const closedResult = await closed.engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(closed.instanceIds.desktop),
    { kind: 'instance', moduleId: 'desktop', instanceId: closed.instanceIds.desktop },
  );
  assert.equal(closedResult.ok, false);
  assert.equal(closedResult.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  assert.equal(closed.engine.getCommitted().revision, closedRevision);
});

test('unsupported interaction and malformed targets are typed failures with no pseudo-success', async () => {
  const { engine, instanceIds } = await createIntegratedEngine();
  const revision = engine.getCommitted().revision;
  const issuer = { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop };
  const replayBefore = engine.buildReplayRecord();
  const unsupported = await engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(instanceIds.desktop, { type: 'ecosystem.reference.unknown' }),
    issuer,
  );
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'SIMULATOR_UNSUPPORTED');
  const malformed = await engine.acceptCommand(
    'simulator.interaction.emit',
    referenceEnvelope(instanceIds.desktop, { targets: ['tester', 'zhiyu'] }),
    issuer,
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'SIMULATOR_INVALID_PAYLOAD');
  assert.equal(engine.getCommitted().revision, revision);
  const replayAfter = engine.buildReplayRecord();
  assert.deepEqual(replayAfter.inputs, replayBefore.inputs);
  assert.deepEqual(replayAfter.operationSettlements, replayBefore.operationSettlements);
});

for (const [name, emittedEvents] of [
  ['missing', []],
  ['duplicate', [
    { type: 'zhiyu.ecosystem.projected', payload: null },
    { type: 'zhiyu.ecosystem.projected', payload: null },
  ]],
]) {
  test(`${name} expected continuation event terminates the session after the source transaction`, async () => {
    const behavior = {
      ...zhiyuSimulatorBehavior,
      reduce(current, envelope, context) {
        const reduction = zhiyuSimulatorBehavior.reduce(current, envelope, context);
        if (envelope.type !== 'zhiyu.ecosystem.project') return reduction;
        return {
          state: reduction.state,
          events: emittedEvents.map((event) => ({
            ...event,
            payload: event.payload ?? reduction.events[0].payload,
          })),
        };
      },
    };
    const { engine, instanceIds } = await createIntegratedEngine({ behaviors: { zhiyu: behavior } });
    const result = await engine.acceptCommand(
      'simulator.interaction.emit',
      referenceEnvelope(instanceIds.desktop),
      { kind: 'instance', moduleId: 'desktop', instanceId: instanceIds.desktop },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.value).sort(), ['ecosystemRevision', 'eventId', 'interactionId']);
    assert.equal(engine.phase, 'terminal');
    const tester = engine.projectInstance(instanceIds.tester);
    assert.equal(tester.ok, true);
    assert.equal(tester.value.ecosystemReference, null);
  });
}
