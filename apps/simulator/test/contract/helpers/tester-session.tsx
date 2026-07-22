import assert from 'node:assert/strict';

import { testerSimulatorAdapterFactory } from '../../../../tester/src/simulator/adapter.ts';
import { simulatorConformanceFixture } from '../../../../tester/src/simulator/fixture.ts';
import { testerSimulatorRenderer } from '../../../../tester/src/simulator/renderer.ts';
import { createSimulatorSession } from '../../../src/shell/session.ts';
import { fixtureCanonicalBindings, fixtureScenario } from '../fixtures.mjs';

const readinessDeclaration = simulatorConformanceFixture.readiness[0];
const readinessExpectation = {
  contractId: readinessDeclaration.contractId,
  rootContentSemanticId: readinessDeclaration.rootContentSemanticId,
  primaryControl: readinessDeclaration.primaryControl,
  projectionPredicateId: 'tester-projection-ready',
  blockingStatePredicateId: 'tester-no-blocking-lease',
} as const;

const moduleCatalog = {
  moduleId: 'tester',
  orderingKey: 0,
  commandSchemas: simulatorConformanceFixture.catalog.commandSchemas,
  eventSchemas: simulatorConformanceFixture.catalog.eventSchemas,
  queries: {},
  selectSharedProjection: null,
  moduleData: simulatorConformanceFixture.catalog.moduleData,
} as const;

const registryRow = {
  metadata: {
    moduleId: 'tester',
    orderingKey: 0,
    surfaces: [{
      id: 'main',
      label: 'Nimi Lab',
      initialRoute: '/',
      readinessContractId: readinessDeclaration.contractId,
    }],
    requirements: {
      kitCapabilities: [],
      sdkMethods: ['nimi.ai.generateText'],
      commands: Object.keys(simulatorConformanceFixture.catalog.commandSchemas),
      events: [],
    },
  },
  loadRenderer: async () => testerSimulatorRenderer,
  loadAdapter: async () => testerSimulatorAdapterFactory,
  loadStyle: async () => undefined,
} as const;

let frame = 0;
let surfaceSequence = 0;
const mounted = new Map<string, ReturnType<typeof testerSimulatorRenderer.factory.createInstance>>();

const session = createSimulatorSession({
  scenario: fixtureScenario({
    scenarioId: 'tester-contract-scenario',
    scenarioRevision: 'tester-contract-scenario-1',
    initialLogicalTime: 1_800_000_000_000,
  }),
  registryModules: [registryRow],
  moduleCatalogs: [moduleCatalog],
  timers: {
    setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => performance.now(),
  },
  effectScope: { run: (_owner, _phase, callback) => callback() },
  prepareSurface(input) {
    surfaceSequence += 1;
    const kit = fixtureCanonicalBindings(`opaque-tester-${surfaceSequence}`).kit;
    return {
      kit,
      mount(canonical) {
        mounted.set(input.instanceId, canonical as ReturnType<typeof testerSimulatorRenderer.factory.createInstance>);
      },
      unmount() {},
    };
  },
  readinessBrowser: {
    currentCommitToken: () => 0,
    awaitCommit: async ({ sinceToken }) => sinceToken + 1,
    nextAnimationFrame: async () => {
      frame += 1;
      return frame;
    },
    beginPaintComposite: async () => 'fixture-paint-window',
    markPaintCompositeFrame: async () => true,
    observePaintComposite: async () => true,
    checkSemanticMarkers: async () => ({ ok: true }),
  },
  simulationDisclosureVisible: () => true,
  readinessDeclarations: { 'tester/main': readinessDeclaration },
  readinessExpectations: { 'tester/main': readinessExpectation },
  readinessProjectionPredicates: {
    'tester-projection-ready': (value) => (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && value.protocolRevision === 1
    ),
  },
  readinessBlockingPredicates: { 'tester-no-blocking-lease': () => false },
});

const first = await session.openInstance('tester');
const second = await session.openInstance('tester');
assert.equal(first.ok, true);
assert.equal(second.ok, true);
if (!first.ok || !second.ok) throw new Error('Tester instances did not open.');
assert.notEqual(first.value.instanceId, second.value.instanceId);

const firstCanonical = mounted.get(first.value.instanceId);
const secondCanonical = mounted.get(second.value.instanceId);
assert.ok(firstCanonical);
assert.ok(secondCanonical);
assert.notEqual(firstCanonical, secondCanonical);
assert.notEqual(firstCanonical.surfaces, secondCanonical.surfaces);
assert.notEqual(firstCanonical.surfaces.main.render(), secondCanonical.surfaces.main.render());

assert.equal((await session.activateInstance(first.value.instanceId)).ok, true);
assert.equal((await session.activateInstance(second.value.instanceId)).ok, true);
assert.equal((await session.deactivateInstance(first.value.instanceId)).ok, true);
assert.equal((await session.activateInstance(first.value.instanceId)).ok, true);

const executed = await session.engine.acceptCommand('tester.capability.execute', {
  capabilityId: 'text.generate',
  prompt: 'prove deterministic Tester behavior',
  scenarioId: 'contract',
  attachmentCount: 0,
  directive: null,
}, { kind: 'instance', moduleId: 'tester', instanceId: first.value.instanceId });
assert.equal(executed.ok, true);
const beforeReset = session.engine.getCommitted().partitions.modules.tester;
assert.equal(Array.isArray(beforeReset.capabilityExecutions), true);
assert.equal(beforeReset.capabilityExecutions.length, 1);

const readiness = session.readinessFor(second.value.instanceId, 'main');
assert.equal(readiness.ok, true);
if (!readiness.ok) throw new Error('Tester readiness barrier is missing.');
assert.equal(readiness.value.signalCandidate({ contractId: 'tester.main.usable' }).ok, true);
assert.deepEqual(await readiness.value.completion, {
  state: 'usable',
  reason: 'qualified',
  markedAtLogicalTime: 1_800_000_000_000,
});

assert.equal((await session.closeInstance(first.value.instanceId)).ok, true);
assert.throws(() => firstCanonical.surfaces.main.render(), /TESTER_CANONICAL_INSTANCE_DISPOSED/u);
assert.doesNotThrow(() => secondCanonical.surfaces.main.render());

const reset = await session.resetScenario();
assert.equal(reset.ok, true);
assert.throws(() => secondCanonical.surfaces.main.render(), /TESTER_CANONICAL_INSTANCE_DISPOSED/u);
const afterReset = session.engine.getCommitted().partitions.modules.tester;
assert.equal(Array.isArray(afterReset.capabilityExecutions), true);
assert.equal(afterReset.capabilityExecutions.length, 0);

const reopened = await session.openInstance('tester');
assert.equal(reopened.ok, true);
if (!reopened.ok) throw new Error('Tester did not reopen after reset.');
const reopenedCanonical = mounted.get(reopened.value.instanceId);
assert.ok(reopenedCanonical);
assert.notEqual(reopenedCanonical, firstCanonical);
assert.notEqual(reopenedCanonical, secondCanonical);
assert.doesNotThrow(() => reopenedCanonical.surfaces.main.render());
assert.equal((await session.closeInstance(reopened.value.instanceId)).ok, true);

process.stdout.write('tester-session-integration: OK\n');
