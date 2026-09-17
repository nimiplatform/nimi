import assert from 'node:assert/strict';

import { labSimulatorAdapterFactory } from '../../../../lab/src/simulator/adapter.ts';
import { simulatorConformanceFixture } from '../../../../lab/src/simulator/fixture.ts';
import { labSimulatorRenderer } from '../../../../lab/src/simulator/renderer.ts';
import { createSimulatorSession } from '../../../src/shell/session.ts';
import { fixtureCanonicalBindings, fixtureScenario } from '../fixtures.mjs';

const moduleCatalog = {
  moduleId: 'lab',
  orderingKey: 0,
  commandSchemas: simulatorConformanceFixture.catalog.commandSchemas,
  eventSchemas: simulatorConformanceFixture.catalog.eventSchemas,
  queries: {},
  selectSharedProjection: null,
  moduleData: simulatorConformanceFixture.catalog.moduleData,
} as const;

const registryRow = {
  metadata: {
    moduleId: 'lab',
    orderingKey: 0,
    surfaces: [{
      id: 'main',
      label: 'Nimi Lab',
      initialRoute: '/',
    }],
    requirements: {
      kitCapabilities: [],
      sdkMethods: [],
      commands: Object.keys(simulatorConformanceFixture.catalog.commandSchemas),
      events: [],
    },
  },
  loadRenderer: async () => labSimulatorRenderer,
  loadAdapter: async () => labSimulatorAdapterFactory,
  loadStyle: async () => undefined,
} as const;

let surfaceSequence = 0;
const mounted = new Map<string, ReturnType<typeof labSimulatorRenderer.factory.createInstance>>();

const session = createSimulatorSession({
  scenario: fixtureScenario({
    scenarioId: 'lab-contract-scenario',
    scenarioRevision: 'lab-contract-scenario-1',
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
    const kit = fixtureCanonicalBindings(`opaque-lab-${surfaceSequence}`).kit;
    return {
      kit,
      mount(canonical) {
        mounted.set(input.instanceId, canonical as ReturnType<typeof labSimulatorRenderer.factory.createInstance>);
      },
      unmount() {},
    };
  },
});

const first = await session.openInstance('lab');
const second = await session.openInstance('lab');
assert.equal(first.ok, true);
assert.equal(second.ok, true);
if (!first.ok || !second.ok) throw new Error('Lab instances did not open.');
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

const executed = await session.engine.acceptCommand('lab.capability.execute', {
  capabilityId: 'text.generate',
  prompt: 'prove deterministic Lab behavior',
}, { kind: 'instance', moduleId: 'lab', instanceId: first.value.instanceId });
assert.equal(executed.ok, true);
const beforeReset = session.engine.getCommitted().partitions.modules.lab;
assert.equal(Array.isArray(beforeReset.capabilityExecutions), true);
assert.equal(beforeReset.capabilityExecutions.length, 1);

const readiness = session.readinessFor(second.value.instanceId, 'main');
assert.equal(readiness.ok, true);
if (!readiness.ok) throw new Error('Lab readiness barrier is missing.');
assert.equal(readiness.value.signalCandidate().ok, true);
assert.deepEqual(await readiness.value.completion, {
  state: 'usable',
  reason: 'ready',
  markedAtLogicalTime: 1_800_000_000_000,
});

assert.equal((await session.closeInstance(first.value.instanceId)).ok, true);
assert.throws(() => firstCanonical.surfaces.main.render(), /LAB_CANONICAL_INSTANCE_DISPOSED/u);
assert.doesNotThrow(() => secondCanonical.surfaces.main.render());

const reset = await session.resetScenario();
assert.equal(reset.ok, true);
assert.throws(() => secondCanonical.surfaces.main.render(), /LAB_CANONICAL_INSTANCE_DISPOSED/u);
const afterReset = session.engine.getCommitted().partitions.modules.lab;
assert.equal(Array.isArray(afterReset.capabilityExecutions), true);
assert.equal(afterReset.capabilityExecutions.length, 0);

const reopened = await session.openInstance('lab');
assert.equal(reopened.ok, true);
if (!reopened.ok) throw new Error('Lab did not reopen after reset.');
const reopenedCanonical = mounted.get(reopened.value.instanceId);
assert.ok(reopenedCanonical);
assert.notEqual(reopenedCanonical, firstCanonical);
assert.notEqual(reopenedCanonical, secondCanonical);
assert.doesNotThrow(() => reopenedCanonical.surfaces.main.render());
assert.equal((await session.closeInstance(reopened.value.instanceId)).ok, true);

process.stdout.write('lab-session-integration: OK\n');
