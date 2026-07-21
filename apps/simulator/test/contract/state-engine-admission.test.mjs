import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import {
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SCENARIO_ISSUER,
  SHELL_ISSUER,
} from './fixtures.mjs';

function secondModule() {
  const definition = fixtureModule('module-b');
  definition.commandSchemas = {
    'module-b.increment': {
      kind: 'object',
      properties: { by: { kind: 'integer', minimum: 0, maximum: 1000 } },
    },
  };
  definition.eventSchemas = {
    'module-b.state.changed': { kind: 'object', properties: { value: { kind: 'integer' } } },
  };
  definition.queries = {};
  definition.behavior = {
    ...definition.behavior,
    reduce(state, envelope) {
      const value = state.counter + envelope.payload.by;
      return { state: { ...state, counter: value }, events: [{ type: 'module-b.state.changed', payload: { value } }] };
    },
  };
  return definition;
}

async function openPreparing(engine, moduleId) {
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId,
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, SHELL_ISSUER);
  assert.equal(opened.ok, true);
  const instanceId = opened.value.instanceId;
  const loaded = await engine.acceptCommand('simulator.instance.transition', {
    instanceId,
    transition: 'module_loaded',
  }, SHELL_ISSUER);
  assert.equal(loaded.ok, true);
  return instanceId;
}

async function finishPreparing(engine, instanceId) {
  const prepared = await engine.acceptCommand('simulator.instance.transition', {
    instanceId,
    transition: 'prepare_success',
  }, SHELL_ISSUER);
  assert.equal(prepared.ok, true);
}

function instanceIssuer(moduleId, instanceId) {
  return { kind: 'instance', moduleId, instanceId };
}

test('caller admission is closed over module, event, route, clock, overlay, stream, and reservation ownership', async () => {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  const first = fixtureModule();
  const second = secondModule();
  registerFixtureModule(engine, first);
  registerFixtureModule(engine, second);
  engine.registerStreamMethod({
    methodId: 'fixture-stream',
    ownerModuleId: 'fixture-module',
    sourceEventType: 'fixture-module.counter.changed',
    terminalEventType: null,
    itemSchema: { kind: 'object', properties: { value: { kind: 'integer' } } },
    terminalSchema: { kind: 'json' },
  });
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'module-b' }, SHELL_ISSUER);

  const firstId = await openPreparing(engine, 'fixture-module');
  const firstIssuer = instanceIssuer('fixture-module', firstId);
  const prepareWindow = engine.beginPrepareWindow(firstId);
  assert.equal(prepareWindow.ok, true);
  const foreignEvent = engine.subscribeEvent(prepareWindow.value, 'module-b.state.changed', () => {});
  const undeclaredEvent = engine.subscribeEvent(prepareWindow.value, 'fixture-module.state.undeclared', () => {});
  const ownEvent = engine.subscribeEvent(prepareWindow.value, 'fixture-module.counter.changed', () => {});
  assert.equal(foreignEvent.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(undeclaredEvent.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(ownEvent.ok, true);
  prepareWindow.value.close();
  await finishPreparing(engine, firstId);

  const secondId = await openPreparing(engine, 'module-b');
  await finishPreparing(engine, secondId);
  const secondIssuer = instanceIssuer('module-b', secondId);

  const ownCommand = await engine.acceptCommand('increment', { by: 1 }, firstIssuer);
  assert.equal(ownCommand.ok, true);
  const beforeDenied = engine.buildReplayRecord().operationSettlements.length;
  const foreignCommand = await engine.acceptCommand('module-b.increment', { by: 1 }, firstIssuer);
  const instanceReset = await engine.acceptCommand('simulator.reset', {}, firstIssuer);
  const instanceOpen = await engine.acceptCommand('simulator.instance.open', {
    moduleId: 'fixture-module',
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, firstIssuer);
  assert.equal(foreignCommand.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(instanceReset.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(instanceOpen.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(engine.buildReplayRecord().operationSettlements.length, beforeDenied);

  const foreignRoute = await engine.acceptCommand('simulator.instance.route', {
    instanceId: secondId,
    route: { pathname: '/foreign', search: [], fragment: null },
  }, firstIssuer);
  const ownRoute = await engine.acceptCommand('simulator.instance.route', {
    instanceId: firstId,
    route: { pathname: '/owned', search: [], fragment: null },
  }, firstIssuer);
  assert.equal(foreignRoute.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(ownRoute.ok, true);

  const foreignSchedule = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'module-b.increment', payload: { by: 1 }, causationId: null, delayMs: 10,
  }, firstIssuer);
  const ownSchedule = await engine.acceptCommand('simulator.clock.schedule', {
    commandType: 'increment', payload: { by: 1 }, causationId: null, delayMs: 10,
  }, firstIssuer);
  assert.equal(foreignSchedule.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal(ownSchedule.ok, true);
  const foreignCancel = await engine.acceptCommand('simulator.clock.cancelJob', {
    jobId: ownSchedule.value.jobId,
  }, secondIssuer);
  const ownCancel = await engine.acceptCommand('simulator.clock.cancelJob', {
    jobId: ownSchedule.value.jobId,
  }, firstIssuer);
  assert.equal(foreignCancel.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.deepEqual(ownCancel.value, { cancelled: true });

  const overlay = await engine.acceptCommand('simulator.overlay.acquire', {
    ownerInstanceId: firstId,
    options: {
      kind: 'dialog', modal: true, dismissOnEscape: true, dismissOnOutsidePointer: true,
      returnFocus: true, initialFocusSemanticId: null, returnFocusSemanticId: null,
      scrollLock: 'simulator-root', ariaLabel: 'Owned overlay',
    },
  }, firstIssuer);
  assert.equal(overlay.ok, true);
  const foreignDismiss = await engine.acceptCommand('simulator.overlay.dismiss', {
    overlayId: overlay.value.overlayId, reason: 'app',
  }, secondIssuer);
  assert.equal(foreignDismiss.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  assert.equal((await engine.acceptCommand('simulator.overlay.dismiss', {
    overlayId: overlay.value.overlayId, reason: 'app',
  }, firstIssuer)).ok, true);
  assert.equal((await engine.acceptCommand('simulator.overlay.beginRelease', {
    overlayId: overlay.value.overlayId,
  }, firstIssuer)).ok, true);
  assert.equal((await engine.acceptCommand('simulator.overlay.released', {
    overlayId: overlay.value.overlayId,
  }, firstIssuer)).ok, true);

  const foreignReservation = engine.reserveAsync({
    issuer: firstIssuer,
    causationId: null,
    commandType: 'module-b.increment',
    outcomeSchemaId: 'module-b-outcome',
  });
  assert.equal(foreignReservation.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  const ownReservation = engine.reserveAsync({
    issuer: firstIssuer,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-outcome',
  });
  assert.equal(ownReservation.value.reservationId, '1:async:1');
  ownReservation.value.cancel('caller');
  const fakeReservation = engine.reserveAsync({
    issuer: instanceIssuer('fixture-module', '1:instance:999'),
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-outcome',
  });
  assert.equal(fakeReservation.error.code, 'SIMULATOR_INSTANCE_DISPOSED');
  const nextReservation = engine.reserveAsync({
    issuer: SHELL_ISSUER,
    causationId: null,
    commandType: 'increment',
    outcomeSchemaId: 'fixture-outcome',
  });
  assert.equal(nextReservation.value.reservationId, '1:async:2');
  nextReservation.value.cancel('caller');

  const foreignStream = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream', ownerInstanceId: secondId,
  }, firstIssuer);
  assert.equal(foreignStream.error.code, 'SIMULATOR_CAPABILITY_DENIED');
  const stream = await engine.acceptCommand('simulator.stream.open', {
    methodId: 'fixture-stream', ownerInstanceId: null,
  }, SHELL_ISSUER);
  assert.equal(stream.value.streamId, '1:stream:1');
  const handle = engine.streamHandle(stream.value.streamId);
  handle.attach(() => {});
  await engine.acceptCommand('simulator.stream.activate', { streamId: stream.value.streamId }, SHELL_ISSUER);
  await engine.acceptCommand('simulator.stream.cancel', {
    streamId: stream.value.streamId, reason: 'caller',
  }, SHELL_ISSUER);
  await handle.completion;

  const reset = await engine.acceptCommand('simulator.reset', {}, SCENARIO_ISSUER);
  assert.equal(reset.ok, true);
  const stale = await engine.acceptCommand('increment', { by: 1 }, firstIssuer);
  assert.equal(stale.error.code, 'SIMULATOR_STALE_EPOCH');
});
