import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCatalogPackageSummary,
  parseRuntimeLocalAsset,
  parseRuntimeLocalManifestSummary,
} from '../src/shell/renderer/bridge/runtime-bridge/types';

test('parseRuntimeLocalManifestSummary keeps icon asset metadata', () => {
  const summary = parseRuntimeLocalManifestSummary({
    path: '/mods/local-chat/mod.manifest.yaml',
    id: 'world.nimi.local-chat',
    sourceId: 'dev-runtime',
    sourceType: 'dev',
    sourceDir: '/mods/local-chat',
    name: 'Local Chat',
    version: '1.0.0',
    entry: 'dist/mods/local-chat/index.js',
    entryPath: '/mods/local-chat/dist/mods/local-chat/index.js',
    iconAsset: 'assets/icon.svg',
    iconAssetPath: '/mods/local-chat/assets/icon.svg',
    styles: ['dist/mods/local-chat/index.css'],
    stylePaths: ['/mods/local-chat/dist/mods/local-chat/index.css'],
    manifest: {
      id: 'world.nimi.local-chat',
    },
  });

  assert.equal(summary.iconAsset, 'assets/icon.svg');
  assert.equal(summary.iconAssetPath, '/mods/local-chat/assets/icon.svg');
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
    packageId: 'world.nimi.local-chat',
    packageType: 'desktop-mod',
    name: 'Local Chat',
    description: 'A chat mod',
    latestVersion: '1.0.0',
    latestChannel: 'stable',
    iconUrl: 'https://catalog.example/assets/mod-icons/world.nimi.local-chat.svg',
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
    'https://catalog.example/assets/mod-icons/world.nimi.local-chat.svg',
  );
});
