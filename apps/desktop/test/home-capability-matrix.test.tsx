import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import {
  HomeCapabilityMatrixView,
  type HomeCapabilityMatrixItem,
} from '../src/shell/renderer/features/home/home-capability-matrix.js';

(globalThis as { React?: typeof React }).React = React;

const ITEMS: readonly HomeCapabilityMatrixItem[] = [
  { capability: 'text.generate', state: 'ready', modelLabel: 'Qwen2.5 7B' },
  { capability: 'audio.synthesize', state: 'preparing', modelLabel: 'Kokoro TTS' },
  { capability: 'audio.transcribe', state: 'attention', modelLabel: 'Whisper Large' },
  { capability: 'image.generate', state: 'unset', modelLabel: null },
];

test('capability matrix displays core modalities, bound models, ready count, and profile/cloud shortcuts', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = renderToStaticMarkup(
    <HomeCapabilityMatrixView
      loading={false}
      failed={false}
      readyCount={2}
      items={ITEMS}
      onSelectCapability={() => {}}
      onOpenProfiles={() => {}}
      onOpenCloud={() => {}}
      onOpenAllCapabilities={() => {}}
    />,
  );
  assert.match(html, /data-testid="home-capability-matrix"/);
  assert.match(html, /2 项就绪/);
  assert.match(html, /data-testid="home-capability-tile:text\.generate"[^>]*data-state="ready"/);
  assert.match(html, /Qwen2\.5 7B/);
  assert.match(html, /Kokoro TTS/);
  assert.match(html, /需处理/);
  assert.match(html, /配置模型/);
  assert.match(html, /data-testid="home-capability-profiles"/);
  assert.match(html, /data-testid="home-capability-cloud"/);
});
