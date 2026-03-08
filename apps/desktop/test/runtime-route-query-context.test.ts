import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCachedRuntimeRouteQueryContext,
  resetRuntimeRouteQueryContextCacheForTests,
} from '../src/shell/renderer/infra/bootstrap/runtime-route-query-context';

test('runtime route query context shares in-flight work and short-lived cache', async () => {
  resetRuntimeRouteQueryContextCacheForTests();

  let nowMs = 1_000;
  let loadCount = 0;

  const load = async () => {
    loadCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { sequence: loadCount };
  };

  const [first, second] = await Promise.all([
    loadCachedRuntimeRouteQueryContext({
      load,
      now: () => nowMs,
      ttlMs: 5_000,
    }),
    loadCachedRuntimeRouteQueryContext({
      load,
      now: () => nowMs,
      ttlMs: 5_000,
    }),
  ]);

  assert.equal(loadCount, 1);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 1);

  nowMs = 3_000;
  const cached = await loadCachedRuntimeRouteQueryContext({
    load,
    now: () => nowMs,
    ttlMs: 5_000,
  });

  assert.equal(loadCount, 1);
  assert.equal(cached.sequence, 1);

  nowMs = 7_000;
  const refreshed = await loadCachedRuntimeRouteQueryContext({
    load,
    now: () => nowMs,
    ttlMs: 5_000,
  });

  assert.equal(loadCount, 2);
  assert.equal(refreshed.sequence, 2);
});
