import assert from 'node:assert/strict';
import test from 'node:test';

import { runtimeInventoryErrorFromSlots } from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.js';

test('Local Assets prioritizes the ModelAsset action error over the inventory read error', () => {
  assert.equal(runtimeInventoryErrorFromSlots({
    'model-assets': 'Runtime ModelAsset inventory failed.',
    'model-asset-action': 'Runtime ModelAsset removal failed.',
  }), 'Runtime ModelAsset removal failed.');
  assert.equal(runtimeInventoryErrorFromSlots({
    'model-assets': 'Runtime ModelAsset inventory failed.',
  }), 'Runtime ModelAsset inventory failed.');
});
