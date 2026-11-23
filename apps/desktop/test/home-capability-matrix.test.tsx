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
  { capability: 'text.generate', state: 'ready', modelLabel: 'Qwen2.5 7B text generation' },
  { capability: 'text.annotate', state: 'unset', modelLabel: null },
  { capability: 'text.decide', state: 'unset', modelLabel: null },
  { capability: 'text.embed', state: 'unset', modelLabel: null },
  { capability: 'image.generate', state: 'unset', modelLabel: null },
  { capability: 'video.generate', state: 'unset', modelLabel: null },
  { capability: 'image.upscale', state: 'unset', modelLabel: null },
  { capability: 'audio.synthesize', state: 'ready', modelLabel: 'PocketTTS audio.cpp synthesis' },
  { capability: 'audio.transcribe', state: 'attention', modelLabel: 'Whisper Large' },
  { capability: 'music.generate', state: 'unset', modelLabel: null },
];

test('capability matrix groups all capabilities into the 3 canonical categories with ready counts, bound models, and shortcuts', async () => {
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
  assert.match(html, /2 项可用/);
  assert.match(html, /对话与文字/);
  assert.match(html, /图像与视频/);
  assert.match(html, /语音与音乐/);
  assert.match(html, /data-testid="home-capability-group:text"[^>]*data-state="ready"/);
  assert.match(html, /1 \/ 4 可用/);
  assert.match(html, /Qwen2\.5 7B/);
  assert.match(html, /data-testid="home-capability-group:visual"[^>]*data-state="unset"/);
  assert.match(html, /共 3 项/);
  assert.match(html, /data-testid="home-capability-group:audio"[^>]*data-state="attention"/);
  assert.match(html, /Whisper Large/);
  assert.match(html, /需处理/);
  assert.match(html, /data-testid="home-capability-profiles"/);
  assert.match(html, /data-testid="home-capability-cloud"/);
  assert.match(html, /data-testid="home-capability-all"/);
});

test('capability matrix trims redundant synthesis/generation suffixes when surfacing a single ready capability in a group', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = renderToStaticMarkup(
    <HomeCapabilityMatrixView
      loading={false}
      failed={false}
      readyCount={1}
      items={[
        { capability: 'text.generate', state: 'unset', modelLabel: null },
        { capability: 'image.generate', state: 'unset', modelLabel: null },
        { capability: 'audio.synthesize', state: 'ready', modelLabel: 'PocketTTS audio.cpp synthesis' },
        { capability: 'audio.transcribe', state: 'unset', modelLabel: null },
      ]}
      onSelectCapability={() => {}}
      onOpenProfiles={() => {}}
      onOpenCloud={() => {}}
      onOpenAllCapabilities={() => {}}
    />,
  );
  assert.match(html, /语音合成 · PocketTTS audio\.cpp</);
  assert.match(html, /1 \/ 2 可用/);
});
