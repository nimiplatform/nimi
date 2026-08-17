import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion';
import {
  LocalModelCenterInstalledAssetsSection,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section';

const TEST_I18N_RESOURCE = {
  instance: {
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  },
  formatRelativeTime: () => 'just now',
} as never;

test('ModelAsset inventory does not project execution environment readiness', () => {
  const asset = {
    modelAssetId: 'model_image_asset',
    contentId: `sha256:${'a'.repeat(64)}`,
    displayName: 'Image Model',
    entry: 'model.gguf',
    files: [{ relativePath: 'model.gguf', sha256: 'a'.repeat(64), sizeBytes: 42, nonExecutableContent: false }],
    totalSizeBytes: 42,
    contentVerified: true,
    catalogVerification: 'not_matched',
    catalogVerified: false,
    unclassified: false,
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
    latestIntegrityCheckedAt: '2026-08-08T00:00:00Z',
    duplicateContent: false,
    containsNonExecutableCode: false,
  };
  const markup = renderToStaticMarkup(React.createElement(DesktopMotionProvider, null, React.createElement(
    DesktopI18nResourceProvider,
    { resource: TEST_I18N_RESOURCE },
    React.createElement(LocalModelCenterInstalledAssetsSection, {
      modelAssets: [asset],
      loadingInstalledAssets: false,
      assetBusy: false,
      onRefreshAssets: () => {},
      onInspectRemoval: async () => [],
      onRemoveAsset: () => {},
    } as never),
  )));

  assert.match(markup, /Model Assets/);
  assert.match(markup, /Image Model/);
  assert.match(markup, /Content verified/);
  assert.doesNotMatch(markup, /Runtime unsupported|Set Up Runtime|local-image-native/iu);
});
