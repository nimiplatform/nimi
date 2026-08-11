import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canImportBundleDirectoryForAssetKind,
} from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-helpers';

test('bundle directory import admits chat and verified speech bundles without broadening unrelated asset kinds', () => {
  assert.equal(canImportBundleDirectoryForAssetKind('chat'), true);
  assert.equal(canImportBundleDirectoryForAssetKind('tts'), true);
  assert.equal(canImportBundleDirectoryForAssetKind('stt'), true);
  assert.equal(canImportBundleDirectoryForAssetKind('image'), false);
});
