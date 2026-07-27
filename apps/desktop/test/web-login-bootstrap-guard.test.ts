import assert from 'node:assert/strict';
import test from 'node:test';

import { connectRuntimeHealthCoordinator } from '../src/shell/renderer/features/runtime-config/runtime-health-coordinator';

test('a disabled shell never connects or starts Runtime health coordination', () => {
  let starts = 0;
  let stops = 0;
  let bootstrapReads = 0;
  let subscriptions = 0;
  const disconnect = connectRuntimeHealthCoordinator({
    start: () => { starts += 1; },
    stop: () => { stops += 1; },
  } as never, {
    bootstrap: () => {
      bootstrapReads += 1;
      return { bootstrapReady: true, bootstrapError: null };
    },
    subscribeBootstrap: () => {
      subscriptions += 1;
      return () => {};
    },
  }, false);

  disconnect();
  assert.deepEqual({ starts, stops, bootstrapReads, subscriptions }, {
    starts: 0,
    stops: 0,
    bootstrapReads: 0,
    subscriptions: 0,
  });
});
