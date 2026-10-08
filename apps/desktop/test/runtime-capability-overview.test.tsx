import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  RuntimeProfileQuickStart,
  type RuntimeOverviewCapability,
} from '../src/shell/renderer/features/runtime-config/runtime-profile-quick-start.js';

(globalThis as { React?: typeof React }).React = React;

// Rendering fixtures exercise summary composition only, not Runtime readiness.
const text: RuntimeOverviewCapability = { id: 'text.generate', model: 'Gemma 4', state: { state: 'ready', replacement: false } };
const image: RuntimeOverviewCapability = { id: 'image.generate', model: 'Z-Image Turbo', state: { state: 'ready', replacement: false } };

async function renderOverview(capabilities: readonly RuntimeOverviewCapability[], language = 'zh', pending = false) {
  const i18n = createInstance();
  const resources = JSON.parse(readFileSync(new URL(`../src/shell/renderer/locales/${language}/46-runtimeConfig.json`, import.meta.url), 'utf8'));
  await i18n.init({ lng: language, resources: { [language]: { translation: { runtimeConfig: resources } } } });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RuntimeProfileQuickStart
        disabled={false}
        capabilities={capabilities}
        onOpenCapability={() => {}}
        onUse={() => {}}
        conversation={{
          pending,
          preparation: capabilities.find(entry => entry.id === 'text.generate')?.state ?? { state: 'unknown', replacement: false },
          onOpenDetail: () => {}, onOpenTask: () => {}, onRetry: () => {},
        }}
      />
    </I18nextProvider>,
  );
}

test('overview lists every ready capability and its model, excluding unready capabilities', async () => {
  const html = await renderOverview([text, image, { id: 'video.generate', model: 'Unready model', state: { state: 'preparing', replacement: false } }]);
  assert.match(html, /本地AI已就绪/);
  assert.doesNotMatch(html, /项能力在这台设备上本地运行/);
  assert.match(html, /文本生成/);
  assert.match(html, /Gemma 4/);
  assert.match(html, /Z-Image Turbo/);
  assert.match(html, /aria-label="查看文本生成"/);
  assert.match(html, /aria-label="查看图像生成"/);
  assert.equal((html.match(/data-ready-capability=/g) ?? []).length, 2);
  assert.doesNotMatch(html, /本机对话已就绪|Unready model|开始聊天|Nimi 聊天|本机默认/);
  assert.equal((html.match(/已就绪/g) ?? []).length, 1, 'readiness appears only in the summary heading');
});

test('image readiness remains visible without ready text generation, in both locales', async () => {
  for (const language of ['zh', 'en']) {
    const html = await renderOverview([image], language);
    assert.match(html, language === 'zh' ? /本地AI已就绪/ : /Local AI is ready/);
    assert.doesNotMatch(html, language === 'zh' ? /项能力在这台设备上本地运行/ : /capability runs on this device/);
    assert.match(html, /Z-Image Turbo/);
    assert.doesNotMatch(html, /data-ready-capability="text.generate"|Gemma 4|runtimeConfig\./);
  }
});

test('pending and unknown inventory never produce a ready summary', async () => {
  assert.match(await renderOverview([image], 'zh', true), /data-quick-start-state="pending"/);
  const html = await renderOverview([]);
  assert.match(html, /data-quick-start-state="unknown"/);
  assert.doesNotMatch(html, /data-ready-capability=/);
});
