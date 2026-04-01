import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RuntimeLocalAnonymousMethodIds,
  RuntimeMethodIds,
  RuntimeWriteMethodIds,
  isRuntimeLocalAnonymousMethod,
  isRuntimeWriteMethod,
} from '../../src/runtime/method-ids.js';
import { buildLocalImageProfileExtensions } from '../../src/runtime/runtime-media.js';

test('runtime method groups classify local asset RPCs correctly', () => {
  const anonymousMethods = [
    RuntimeMethodIds.local.listLocalAssets,
    RuntimeMethodIds.local.listVerifiedAssets,
  ];
  const writeMethods = [
    RuntimeMethodIds.local.installVerifiedAsset,
    RuntimeMethodIds.local.importLocalAsset,
    RuntimeMethodIds.local.removeLocalAsset,
  ];

  for (const methodId of anonymousMethods) {
    assert.equal(RuntimeLocalAnonymousMethodIds.includes(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), false);
  }

  for (const methodId of writeMethods) {
    assert.equal(RuntimeWriteMethodIds.includes(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), false);
  }
});

test('runtime method groups classify local profile RPCs correctly', () => {
  assert.equal(RuntimeLocalAnonymousMethodIds.includes(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.resolveProfile), false);

  assert.equal(RuntimeWriteMethodIds.includes(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.applyProfile), false);
});

test('buildLocalImageProfileExtensions normalizes entry overrides and preserves unrelated extensions', () => {
  const extensions = buildLocalImageProfileExtensions(
    {
      entryOverrides: [
        { entryId: '  image-vae  ', localAssetId: ' asset-vae ' },
        { entryId: 'text-encoder', localAssetId: 'asset-llm' },
        { entryId: '', localAssetId: 'ignored-empty-entry' },
        { entryId: 'clip', localAssetId: '' },
      ],
      profileOverrides: {
        step: 8,
        cfg_scale: 1.5,
      },
    },
    {
      preserved: true,
    },
  );

  assert.deepEqual(extensions, {
    preserved: true,
    entry_overrides: [
      { entry_id: 'image-vae', local_asset_id: 'asset-vae' },
      { entry_id: 'text-encoder', local_asset_id: 'asset-llm' },
    ],
    profile_overrides: {
      step: 8,
      cfg_scale: 1.5,
    },
  });
});
