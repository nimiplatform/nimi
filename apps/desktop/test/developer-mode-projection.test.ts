import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeveloperModeProjection } from '../src/shell/renderer/features/developer/developer-mode';

function projection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'disabled',
    enabled: false,
    revision: 1,
    accountGeneration: 0,
    reasonCode: 'action-executed',
    retryable: false,
    ...overrides,
  };
}

test('Developer Mode accepts the initial disabled projection without an account generation', () => {
  assert.deepEqual(parseDeveloperModeProjection(projection()), projection());
});

test('Developer Mode requires account binding only when enabled', () => {
  assert.throws(
    () => parseDeveloperModeProjection(projection({ state: 'enabled', enabled: true })),
    /developer-mode-projection-invalid/u,
  );
  assert.deepEqual(
    parseDeveloperModeProjection(projection({
      state: 'enabled',
      enabled: true,
      revision: 2,
      accountGeneration: 1,
    })),
    projection({ state: 'enabled', enabled: true, revision: 2, accountGeneration: 1 }),
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
