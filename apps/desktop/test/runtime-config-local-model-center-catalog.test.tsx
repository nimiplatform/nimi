import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { LocalModelCatalogSection, filterVerifiedModelsForSearch } from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-catalog';

const assets: NimiRuntimeLocalVerifiedAssetDescriptor[] = [
  {
    templateId: 'speech.variant', assetId: 'speech.variant', title: 'Qwen3 TTS Custom Voice', description: 'Speech model', kind: 'tts',
    repo: 'audio-cpp/audio.cpp-gguf', revision: 'revision', engine: 'audio-cpp', entry: 'voice.gguf', files: ['voice.gguf'],
    license: 'MIT', hashes: {}, fileCount: 1, contentId: 'sha256:speech-content', tags: ['speech'], capabilities: ['audio.synthesize'],
  },
  {
    templateId: 'vae.variant', assetId: 'vae.variant', title: 'Image VAE', description: 'Supporting asset', kind: 'vae',
    repo: 'example/vae', revision: 'revision', engine: '', entry: 'vae.safetensors', files: ['vae.safetensors'],
    license: 'MIT', hashes: {}, fileCount: 1, contentId: 'sha256:vae-content', tags: [], capabilities: [],
  },
];

test('built-in catalog preserves tokenized discovery for speech and passive assets', () => {
  assert.deepEqual(filterVerifiedModelsForSearch(assets, 'qwen3-tts-audio'), [assets[0]]);
  assert.deepEqual(filterVerifiedModelsForSearch(assets, 'vae'), [assets[1]]);
  assert.deepEqual(filterVerifiedModelsForSearch(assets, 'sha256:vae-content'), [assets[1]]);
  assert.deepEqual(filterVerifiedModelsForSearch(assets, 'qwen3 missing'), []);
});

test('built-in catalog renders known assets and its own read error independently', () => {
  const resource = { instance: { t: (key: string) => key } } as never;
  const render = (error: string) => renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={resource}>
      <LocalModelCatalogSection assets={assets} loading={false} error={error} runtimeWritesDisabled={false}
        onRefresh={() => {}} onInstall={async () => { throw new Error('render must not start an install'); }} />
    </DesktopI18nResourceProvider>,
  );
  const loaded = render('');
  assert.match(loaded, /runtime-builtin-catalog/);
  assert.match(loaded, /Qwen3 TTS Custom Voice/);
  assert.match(loaded, /Image VAE/);
  assert.match(loaded, /data-catalog-template="speech.variant"/);
  assert.match(render('local catalog read failed'), /local catalog read failed/);
  assert.doesNotMatch(loaded, /local catalog read failed/);
});
