import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion';
import {
  ASSET_KIND_OPTIONS,
  formatAssetKindLabel,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers';
import {
  LocalModelCenterUnregisteredAssetsSection,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections';
import {
  LocalModelCenterInstalledAssetsSection,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section';

const TEST_I18N_RESOURCE = {
  instance: {
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  },
  formatRelativeTime: () => 'just now',
} as never;

test('passive asset options include VAE with a user-facing label', () => {
  assert.ok(ASSET_KIND_OPTIONS.includes('vae'));
  assert.equal(formatAssetKindLabel('vae'), 'VAE');
});

test('unregistered assets remain a user-confirmed review surface', () => {
  const asset = {
    filename: 'decoder.vae.safetensors',
    path: '/models/decoder.vae.safetensors',
    sizeBytes: 1_024,
    suggestionSource: 'filename',
    confidence: 'low',
    autoImportable: false,
    requiresManualReview: true,
  };
  const markup = renderToStaticMarkup(React.createElement(DesktopMotionProvider, null, React.createElement(
    DesktopI18nResourceProvider,
    { resource: TEST_I18N_RESOURCE },
    React.createElement(LocalModelCenterUnregisteredAssetsSection, {
        assets: [asset],
        assetImportError: '',
        importingAssetPath: null,
        resolveDraft: () => ({ assetKind: 'vae' }),
        onRefresh: () => {},
        onAssetKindChange: () => {},
        onAuxiliaryEngineChange: () => {},
        onImport: () => {},
      } as never),
    )));

  assert.match(markup, /Unregistered Assets/);
  assert.match(markup, /Discovered assets stay pending until you choose Import/);
  assert.match(markup, /decoder\.vae\.safetensors/);
  assert.match(markup, /Review needed/);
  assert.match(markup, />Import</);
  assert.doesNotMatch(markup, /endpoint/iu);
});

test('installed asset inventory does not project execution environment readiness', () => {
  const asset = {
    localAssetId: 'local/image-asset',
    assetId: 'local/image-asset',
    displayName: 'Image Model',
    sourceFileName: 'model.gguf',
    kind: 'image',
    engine: 'media',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: 'unknown',
    source: { repo: 'file:///models/image', revision: 'import' },
    integrityMode: 'sha256',
    hashes: {},
    status: 'installed',
    installedAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
    capabilities: ['image.generate'],
  };
  const markup = renderToStaticMarkup(React.createElement(DesktopMotionProvider, null, React.createElement(
    DesktopI18nResourceProvider,
    { resource: TEST_I18N_RESOURCE },
    React.createElement(LocalModelCenterInstalledAssetsSection, {
        filteredInstalledRunnableAssets: [asset],
        filteredInstalledDependencyAssets: [],
        loadingInstalledAssets: false,
        loadingVerifiedAssets: false,
        assetKindFilter: 'all',
        assetBusy: false,
        onArtifactKindFilterChange: () => {},
        onRefreshAssets: () => {},
        onRemoveAsset: () => {},
        onRescanAsset: () => {},
      } as never),
    )));

  assert.match(markup, /My Models/);
  assert.match(markup, /Image Model/);
  assert.match(markup, />Installed</);
  assert.doesNotMatch(markup, /Runtime unsupported|Set Up Runtime|local-image-native/iu);
});
