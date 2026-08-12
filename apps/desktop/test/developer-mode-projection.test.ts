import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeveloperModeProjection } from '../src/shell/renderer/features/developer/developer-mode';

function projection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'disabled',
    enabled: false,
    revision: 1,
    reasonCode: 'action-executed',
    retryable: false,
    ...overrides,
  };
}

test('Developer Mode accepts the Runtime projection without an account generation', () => {
  assert.deepEqual(parseDeveloperModeProjection(projection()), projection());
});

test('Developer Mode accepts enabled state with a monotonic revision', () => {
  assert.deepEqual(
    parseDeveloperModeProjection(projection({
      state: 'enabled',
      enabled: true,
      revision: 2,
    })),
    projection({ state: 'enabled', enabled: true, revision: 2 }),
  );
});

test('Developer Mode rejects zero revision and extra renderer fields', () => {
  assert.throws(
    () => parseDeveloperModeProjection(projection({ revision: 0 })),
    /developer-mode-projection-invalid/u,
  );
  assert.throws(
    () => parseDeveloperModeProjection(projection({ accountId: 'renderer-controlled' })),
    /developer-mode-projection-invalid/u,
  );
});
