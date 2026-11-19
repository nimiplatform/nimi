import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
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
const speech: RuntimeOverviewCapability = { id: 'audio.synthesize', model: 'VoxCPM2 audio.cpp', state: { state: 'ready', replacement: false } };

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
  assert.match(html, /可用能力 · 2/);
  assert.doesNotMatch(html, /项能力在这台设备上本地运行/);
  assert.match(html, /文本生成/);
  assert.match(html, /Gemma 4/);
  assert.match(html, /Z-Image Turbo/);
  assert.match(html, /aria-label="查看文本生成"/);
  assert.match(html, /aria-label="查看图像生成"/);
  assert.equal((html.match(/data-ready-capability=/g) ?? []).length, 2);
  assert.doesNotMatch(html, /本机对话已就绪|Unready model|开始聊天|Nimi 聊天|本机默认/);
  assert.equal((html.match(/可用能力/g) ?? []).length, 1, 'the summary states the scope of readiness once');
});

test('image readiness remains visible without ready text generation, in both locales', async () => {
  for (const language of ['zh', 'en']) {
    const html = await renderOverview([image], language);
    assert.match(html, language === 'zh' ? /可用能力 · 1/ : /Ready capabilities · 1/);
    assert.doesNotMatch(html, language === 'zh' ? /项能力在这台设备上本地运行/ : /capability runs on this device/);
    assert.match(html, /Z-Image Turbo/);
    assert.doesNotMatch(html, /data-ready-capability="text.generate"|Gemma 4|runtimeConfig\./);
  }
});

test('pending and unknown inventory never produce a ready summary', async () => {
  assert.match(await renderOverview([image], 'zh', true), /data-quick-start-state="pending"/);
  const html = await renderOverview([]);
  assert.match(html, /data-quick-start-state="unknown"/);
  assert.match(html, /nimi-surface--hero/);
  assert.doesNotMatch(html, /data-ready-capability=/);
});

test('ready overview uses neutral card surface, groups by domain, and filters via category tabs', async () => {
  const html = await renderOverview([text, image, speech], 'zh');
  assert.match(html, /nimi-surface--card/);
  assert.doesNotMatch(html, /nimi-surface--hero/);
  assert.match(html, /data-ready-capability-group="text"/);
  assert.match(html, /data-ready-capability-group="visual"/);
  assert.match(html, /data-ready-capability-group="audio"/);
  assert.match(html, /data-testid="ai-ready-capability-groups"/);

  // Single-group ready overview omits the category filter bar.
  const singleGroupHtml = await renderOverview([image], 'zh');
  assert.doesNotMatch(singleGroupHtml, /data-testid="ai-ready-capability-groups"/);

  // Interactive category filtering narrows visible capabilities and restores all.
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevHTMLElement = globalThis.HTMLElement;
  const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const i18n = createInstance();
  const resources = JSON.parse(readFileSync(new URL('../src/shell/renderer/locales/zh/46-runtimeConfig.json', import.meta.url), 'utf8'));
  await i18n.init({ lng: 'zh', resources: { zh: { translation: { runtimeConfig: resources } } } });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const opened: string[] = [];
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RuntimeProfileQuickStart
            disabled={false}
            capabilities={[text, image, speech]}
            onOpenCapability={(id) => opened.push(id)}
            onUse={() => {}}
            conversation={{
              pending: false,
              preparation: text.state,
              onOpenDetail: () => {}, onOpenTask: () => {}, onRetry: () => {},
            }}
          />
        </I18nextProvider>,
      );
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 3);
    const tabs = Array.from(container.querySelectorAll('[data-testid="ai-ready-capability-groups"] [role="radio"]'));
    assert.equal(tabs.length, 4);
    const audioTab = tabs.find((tab) => tab.textContent?.includes('语音与音乐')) as HTMLElement | undefined;
    assert.ok(audioTab);
    await act(async () => {
      audioTab.click();
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 1);
    assert.ok(container.querySelector('[data-ready-capability="audio.synthesize"]'));
    assert.equal(container.querySelector('[data-ready-capability="text.generate"]'), null);

    // Clicking the filtered capability opens its detail view.
    await act(async () => {
      (container.querySelector('[data-ready-capability="audio.synthesize"]') as HTMLElement).click();
    });
    assert.deepEqual(opened, ['audio.synthesize']);

    // Returning to "All" restores every capability group.
    const allTab = tabs[0] as HTMLElement;
    await act(async () => {
      allTab.click();
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 3);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    Object.assign(globalThis, {
      window: prevWindow,
      document: prevDocument,
      HTMLElement: prevHTMLElement,
      IS_REACT_ACT_ENVIRONMENT: prevActEnv,
    });
  }
});
