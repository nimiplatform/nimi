import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopSimulatorBehavior } from '../src/simulator/behavior.js';

const initialInput = {
  scenarioId: 'desktop-conformance',
  scenarioRevision: '1',
  moduleData: { locale: 'en' },
  sharedProjection: {},
} as const;

test('Desktop Simulator behavior commits locale changes with the State Engine clock', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  const reduced = desktopSimulatorBehavior.reduce(
    initial,
    {
      type: 'desktop.locale.apply',
      payload: { locale: 'zh', lang: 'zh-CN', title: 'Nimi' },
    },
    { now: 42, drawRandom: () => 0.5 },
  );

  assert.deepEqual(reduced, {
    state: { protocolRevision: 1, locale: 'zh', appliedAt: 42, bootstrapReady: true },
    events: [],
  });
});

test('Desktop Simulator behavior publishes declared logical timer events without wall-clock state', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  const reduced = desktopSimulatorBehavior.reduce(
    initial,
    { type: 'desktop.renderer.timer.fire', payload: { token: 'instance-1:timer:1' } },
    { now: 60_000, drawRandom: () => 0.5 },
  );

  assert.deepEqual(reduced, {
    state: initial,
    events: [{
      type: 'desktop.renderer.timer.fired',
      payload: { token: 'instance-1:timer:1' },
    }],
  });
});

test('Desktop Simulator behavior fails closed for undeclared commands and invalid locale data', () => {
  const initial = desktopSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => desktopSimulatorBehavior.reduce(
      initial,
      { type: 'desktop.mock.success', payload: {} },
      { now: 42, drawRandom: () => 0.5 },
    ),
    /DESKTOP_SIMULATOR_COMMAND_UNDECLARED/,
  );
  assert.throws(
    () => desktopSimulatorBehavior.initialState({ ...initialInput, moduleData: { locale: 'fr' } }),
    /DESKTOP_SIMULATOR_LOCALE_INVALID/,
  );
});

test('Desktop Simulator projection preserves deterministic route structure', () => {
  const projected = desktopSimulatorBehavior.project(
    desktopSimulatorBehavior.initialState(initialInput),
    {
      surfaceId: 'main',
      route: {
        pathname: '/login',
        search: [{ key: 'return', value: 'desktop' }],
        fragment: 'account',
      },
      sharedProjection: {},
    },
  );

  assert.deepEqual(projected, {
    protocolRevision: 1,
    locale: 'en',
    appliedAt: null,
    bootstrapReady: true,
    surfaceId: 'main',
    route: {
      pathname: '/login',
      search: [{ key: 'return', value: 'desktop' }],
      fragment: 'account',
    },
  });
});
