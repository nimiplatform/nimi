import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCatalogPackageSummary,
  parseRuntimeLocalAsset,
  parseRuntimeLocalManifestSummary,
} from '../src/shell/renderer/bridge/runtime-bridge/types';

test('parseRuntimeLocalManifestSummary keeps icon asset metadata', () => {
  const summary = parseRuntimeLocalManifestSummary({
    path: '/mods/test-ai/mod.manifest.yaml',
    id: 'world.nimi.test-ai',
    sourceId: 'dev-runtime',
    sourceType: 'dev',
    sourceDir: '/mods/test-ai',
    name: 'Test AI',
    version: '1.0.0',
    entry: 'dist/mods/test-ai/index.js',
    entryPath: '/mods/test-ai/dist/mods/test-ai/index.js',
    iconAsset: 'assets/icon.svg',
    iconAssetPath: '/mods/test-ai/assets/icon.svg',
    styles: ['dist/mods/test-ai/index.css'],
    stylePaths: ['/mods/test-ai/dist/mods/test-ai/index.css'],
    manifest: {
      id: 'world.nimi.test-ai',
    },
  });

  assert.equal(summary.iconAsset, 'assets/icon.svg');
  assert.equal(summary.iconAssetPath, '/mods/test-ai/assets/icon.svg');
});

test('parseRuntimeLocalAsset validates mime and base64 fields', () => {
  const payload = parseRuntimeLocalAsset({
    mimeType: 'image/svg+xml',
    base64: 'PHN2Zy8+',
  });

  assert.deepEqual(payload, {
    mimeType: 'image/svg+xml',
    base64: 'PHN2Zy8+',
  });
});

test('parseCatalogPackageSummary keeps optional iconUrl', () => {
  const summary = parseCatalogPackageSummary({
    packageId: 'world.nimi.test-ai',
    packageType: 'desktop-mod',
    name: 'Test AI',
    description: 'A test mod',
    latestVersion: '1.0.0',
    latestChannel: 'stable',
    iconUrl: 'https://catalog.example/assets/mod-icons/world.nimi.test-ai.svg',
    publisher: {
      publisherId: 'nimi',
      displayName: 'Nimi',
      trustTier: 'official',
    },
    state: {
      listed: true,
      yanked: false,
      quarantined: false,
    },
    keywords: [],
    tags: [],
  });

  assert.equal(
    summary.iconUrl,
    'https://catalog.example/assets/mod-icons/world.nimi.test-ai.svg',
  );
});
