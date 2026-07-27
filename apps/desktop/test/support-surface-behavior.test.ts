import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  NIMI_PRODUCT_CONTROL_STATES,
  isNimiProductControlDegradedState,
  isNimiProductControlRepairRoutedState,
} from '@nimiplatform/sdk/runtime';
import {
  SUPPORT_DEGRADED_REACHABLE_SECTIONS,
  SUPPORT_SECTION_IDS,
  isSupportSectionId,
  resolveSupportSection,
} from '../src/shell/renderer/features/support/support-sections.js';

test('support exposes the closed set of product-control sections', () => {
  assert.deepEqual(
    [...SUPPORT_SECTION_IDS],
    ['repair', 'updates', 'diagnostics', 'logs', 'recovery'],
  );
});

test('support section resolution rejects unknown sub-areas', () => {
  assert.equal(resolveSupportSection('updates'), 'updates');
  assert.equal(resolveSupportSection('nonexistent'), 'repair');
  assert.equal(resolveSupportSection(null), 'repair');
  assert.equal(isSupportSectionId('diagnostics'), true);
  assert.equal(isSupportSectionId('settings'), false);
});

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

test('degraded support exposes only repair and recovery sections', () => {
  assert.deepEqual([...SUPPORT_DEGRADED_REACHABLE_SECTIONS], ['repair', 'recovery']);
});
