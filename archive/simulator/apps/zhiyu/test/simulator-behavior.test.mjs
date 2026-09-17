import assert from 'node:assert/strict';
import test from 'node:test';

import { zhiyuSimulatorBehavior } from '../src/simulator/behavior.ts';
import { simulatorConformanceFixture } from '../src/simulator/fixture.ts';

const initialInput = {
  scenarioId: 'zhiyu-persona-test',
  scenarioRevision: '1',
  moduleData: simulatorConformanceFixture.catalog.moduleData,
  sharedProjection: {},
};

const context = { now: 42, drawRandom: () => 0.5 };

const persona = {
  accountId: 'sim-account-linche',
  userId: 'u_7f3a',
  displayName: '林澈',
  role: '生态居民 · 早期体验者',
  realmEnvironmentId: 'sim-realm-env-desktop',
};

const personaPayload = {
  protocolRevision: 1,
  ecosystemRevision: 7,
  interactionId: '1:instance:1:persona-share:2',
  persona,
  committedAt: 42,
};

test('zhiyu derives the canonical persona from the shared Scenario projection', () => {
  const initial = zhiyuSimulatorBehavior.initialState({
    ...initialInput,
    sharedProjection: { persona: personaPayload },
  });
  assert.deepEqual(initial.personaReference, personaPayload);
});

test('zhiyu persona.project commits the persona reference and emits the declared event', () => {
  const initial = zhiyuSimulatorBehavior.initialState(initialInput);
  const reduced = zhiyuSimulatorBehavior.reduce(
    initial,
    { type: 'zhiyu.persona.project', payload: personaPayload },
    context,
  );

  assert.deepEqual(reduced.events, [{ type: 'zhiyu.persona.projected', payload: personaPayload }]);
  assert.deepEqual(reduced.state.personaReference, personaPayload);
  // The ecosystem reference projection is untouched by the persona flow.
  assert.equal(reduced.state.ecosystemReference, null);

  const projected = zhiyuSimulatorBehavior.project(reduced.state, {
    surfaceId: 'main',
    route: { pathname: '/', search: [], fragment: null },
    sharedProjection: {},
  });
  assert.equal(projected.personaReference.persona.displayName, '林澈');
  assert.equal(projected.personaReference.persona.accountId, 'sim-account-linche');
});

test('zhiyu persona.project fails closed for malformed payloads', () => {
  const initial = zhiyuSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => zhiyuSimulatorBehavior.reduce(
      initial,
      { type: 'zhiyu.persona.project', payload: { ...personaPayload, persona: { displayName: '林澈' } } },
      context,
    ),
    /ZHIYU_SIMULATOR_PERSONA/,
  );
  assert.throws(
    () => zhiyuSimulatorBehavior.reduce(
      initial,
      { type: 'zhiyu.persona.project', payload: { ...personaPayload, protocolRevision: 2 } },
      context,
    ),
    /ZHIYU_SIMULATOR_PERSONA_REFERENCE_INVALID/,
  );
});

test('zhiyu handoff.accept stores the handoff card and route without emitting events', () => {
  const initial = zhiyuSimulatorBehavior.initialState(initialInput);
  const route = {
    pathname: '/',
    search: [{ key: 'handoff', value: 'sim-intent-handoff' }],
    fragment: null,
  };
  const payload = {
    protocolRevision: 1,
    ecosystemRevision: 9,
    interactionId: '1:instance:1:sim-handoff-1',
    targetSurfaceId: 'main',
    route,
    card: { title: '在织羽中继续', detail: '模拟交接卡片' },
    committedAt: 42,
  };
  const reduced = zhiyuSimulatorBehavior.reduce(
    initial,
    { type: 'zhiyu.handoff.accept', payload },
    context,
  );

  assert.deepEqual(reduced.events, []);
  assert.deepEqual(reduced.state.handoff, {
    targetSurfaceId: 'main',
    route,
    card: { title: '在织羽中继续', detail: '模拟交接卡片' },
    committedAt: 42,
  });
});

test('zhiyu carry.accept stores the simulated carry summary', () => {
  const initial = zhiyuSimulatorBehavior.initialState(initialInput);
  const reduced = zhiyuSimulatorBehavior.reduce(
    initial,
    {
      type: 'zhiyu.context-projection.accept',
      payload: {
        protocolRevision: 1,
        ecosystemRevision: 11,
        interactionId: '1:instance:1:sim-carry-1',
        carry: '回声谷解谜计划',
        card: { title: '会话摘要', detail: '模拟摘要卡片' },
        committedAt: 42,
      },
    },
    context,
  );

  assert.deepEqual(reduced.events, []);
  assert.deepEqual(reduced.state.carry, {
    carry: '回声谷解谜计划',
    card: { title: '会话摘要', detail: '模拟摘要卡片' },
    committedAt: 42,
  });
});

test('zhiyu behavior keeps undeclared commands fail-closed', () => {
  const initial = zhiyuSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => zhiyuSimulatorBehavior.reduce(
      initial,
      { type: 'zhiyu.persona.drop', payload: {} },
      context,
    ),
    /ZHIYU_SIMULATOR_COMMAND_UNDECLARED/,
  );
});
