import assert from 'node:assert/strict';
import test from 'node:test';

import { generateEffectCatalog } from '../../build/generate-effect-catalog.mjs';
import { installSimulatorEffectGuards } from '../../src/effects/guards.ts';
import { createGlobalListenerCoordinator } from '../../src/shell/global-coordinator.ts';
import { installSimulatorRouteHistoryListener } from '../../src/shell/route-listener.ts';

test('route history install and removal cross the real guard only in the exact Shell scope', () => {
  const generated = generateEffectCatalog({ write: false });
  const globalListener = generated.effects.find(
    (entry) => entry.targetPath === 'globalThis.addEventListener',
  );
  const routeFamily = generated.listenerFamilies.find((entry) => entry.id === 'route_history');
  assert.ok(globalListener);
  assert.ok(routeFamily);
  let installed = 0;
  let released = 0;
  const target = {
    addEventListener(type) {
      assert.equal(type, 'popstate');
      installed += 1;
    },
    removeEventListener(type) {
      assert.equal(type, 'popstate');
      released += 1;
    },
  };
  const guard = installSimulatorEffectGuards({
    catalog: {
      ...generated,
      effects: [globalListener],
      listenerFamilies: [routeFamily],
    },
    target,
  });
  const coordinator = createGlobalListenerCoordinator(
    [routeFamily],
    { window: target, document: target },
    { run: (owner, phase, callback) => guard.withScope({ owner, phase }, callback) },
  );
  const unsubscribe = installSimulatorRouteHistoryListener({
    coordinator,
    onHistory: () => {},
  });
  assert.equal(installed, 1);
  unsubscribe();
  assert.equal(released, 1);
});

test('missing route-history admission fails bootstrap instead of passing unscoped', () => {
  const guard = { withScope: (_scope, callback) => callback() };
  const coordinator = {
    subscribeFamily: () => ({ ok: false, error: { code: 'SIMULATOR_EFFECT_FORBIDDEN' } }),
  };
  assert.throws(
    () => installSimulatorRouteHistoryListener({ coordinator, onHistory: () => {} }),
    /SIMULATOR_ROUTE_LISTENER_UNAVAILABLE/u,
  );
});
