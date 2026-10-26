import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  NIMI_PRODUCT_CONTROL_STATES,
  isNimiProductControlDegradedState,
  isNimiProductControlRepairRoutedState,
} from '@nimiplatform/sdk/runtime';
test('product-control recovery copy mapping is total', () => {
  for (const state of NIMI_PRODUCT_CONTROL_STATES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY, state),
      `recovery copy key missing for state: ${state}`,
    );
  }
});

test('product-control classifies degraded and repair-routed states', () => {
  assert.equal(isNimiProductControlDegradedState('repair_required'), true);
  assert.equal(isNimiProductControlDegradedState('data_root_missing'), true);
  assert.equal(isNimiProductControlDegradedState('ready_for_use'), false);
  assert.equal(isNimiProductControlRepairRoutedState('repair_required'), true);
  assert.equal(isNimiProductControlRepairRoutedState('blocked'), true);
  assert.equal(isNimiProductControlRepairRoutedState('ready_for_use'), false);
});
