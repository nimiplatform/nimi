import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import {
  ASSET_KIND_OPTIONS,
  formatAssetKindLabel,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers';
import {
  LocalModelCenterUnregisteredAssetsSection,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections';

const TEST_I18N_RESOURCE = {
  instance: {
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  },
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
  const markup = renderToStaticMarkup(
    React.createElement(
      DesktopI18nResourceProvider,
      { resource: TEST_I18N_RESOURCE },
      React.createElement(LocalModelCenterUnregisteredAssetsSection, {
        assets: [asset],
        assetImportError: '',
        assetImportSessionByPath: {},
        compatibilityHintByPath: {},
        importAllowedByPath: { [asset.path]: true },
        importingAssetPath: null,
        resolveDraft: () => ({ assetKind: 'vae' }),
        endpointByPath: {},
        endpointRequiredByPath: {},
        endpointHintByPath: {},
        onRefresh: () => {},
        onAssetKindChange: () => {},
        onAuxiliaryEngineChange: () => {},
        onEndpointChange: () => {},
        onImport: () => {},
      } as never),
    ),
  );

  assert.match(markup, /Unregistered Assets/);
  assert.match(markup, /Discovered assets stay pending until you choose Import/);
  assert.match(markup, /decoder\.vae\.safetensors/);
  assert.match(markup, /Review needed/);
  assert.match(markup, />Import</);
});
