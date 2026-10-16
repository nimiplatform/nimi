import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

import { ouYangDeRaw } from './source-detail-world-character-test-utils.js';

async function withDom<T>(run: (dom: JSDOM) => Promise<T>): Promise<T> {
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    return await run(dom);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const presenceRaw = {
  ...ouYangDeRaw,
  worldName: '东南秋声',
  characterProfile: {
    ...ouYangDeRaw.characterProfile,
    knowledgeTopics: ['临安瓦舍勾栏百戏规矩', '听客心理与逗趣包袱'],
    dialogueExemplars: [
      {
        id: 'exemplar-1',
        user: '我荷包里只有几文零钱，听不了整本的大戏。',
        character: '瞧您说的，瓦舍里图的就是个市井热闹！',
      },
    ],
  },
};

test('world character dialogue refresh rotates samples without chat topic shortcuts', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
    const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    const { toSourceDetailData } = await import('../src/shell/renderer/features/source-detail/source-detail-model.js');
    await initI18n();
    await changeLocale('zh');
    try {
      const source = toSourceDetailData(presenceRaw, 'source_materialization_available');
      let worldOpened = 0;
      const bindings = {
        app: { projection: { resourceBaseUrl: () => '' } },
      } as never;
      const root = createRoot(dom.window.document.getElementById('root')!);
      try {
        await act(async () => {
          root.render(
            React.createElement(DesktopRendererBindingProvider, { bindings },
              React.createElement(SourceDetailView, {
                source,
                stats: null,
                loading: false,
                error: false,
                onBack: () => {},
                onOpenWorld: () => { worldOpened += 1; },
                onPrimaryAction: () => {},
              })),
          );
        });
        const document = dom.window.document;
        const sceneText = () => document.querySelector('[data-testid="world-character-meeting-scene"]')?.textContent;
        const initialScene = sceneText();
        assert.ok(initialScene?.includes(presenceRaw.characterProfile.interaction.scenario));
        assert.equal(document.querySelector('[data-testid="world-character-about-section"] [data-testid="world-character-meeting-scene"]'), null);
        const leftColumn = document.querySelector('[data-testid="world-character-profile-column"]');
        assert.ok(leftColumn?.querySelector('[data-testid="world-character-about-section"]'));
        assert.ok(leftColumn?.querySelector('[data-testid="world-character-life-clues-section"]'));
        assert.equal(document.querySelectorAll('[data-testid="world-character-relationship-clues-section"]').length, 0);
        assert.equal(document.querySelector('[data-testid="world-character-topics-section"]'), null);
        assert.equal(document.querySelector('[data-testid="world-character-topic-chip"]'), null);

        // First sample is the authored exemplar pair.
        assert.match(document.querySelector('[data-testid="world-character-dialogue-user"]')?.textContent ?? '', /我荷包里只有几文零钱/);
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /瞧您说的/);

        // 再看一段 rotates to the greeting sample, then wraps back to the exemplar.
        const refresh = document.querySelector<HTMLButtonElement>('[data-testid="world-character-dialogue-refresh"]');
        assert.ok(refresh);
        assert.equal(refresh.textContent, '再看一段');
        await act(async () => { refresh.click(); });
        assert.equal(document.querySelector('[data-testid="world-character-dialogue-user"]'), null);
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /吾乃欧阳德/);
        assert.equal(sceneText(), initialScene);
        await act(async () => { refresh.click(); });
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /瞧您说的/);
        assert.equal(sceneText(), initialScene);

        // The banner world pill opens the hosting world.
        const pill = document.querySelector<HTMLButtonElement>('[data-testid="world-character-world-pill"]');
        assert.ok(pill);
        await act(async () => { pill.click(); });
        assert.equal(worldOpened, 1);

        // Changing the source replaces the shared scene and starts its first sample.
        await act(async () => { refresh.click(); });
        const nextSource = {
          ...source,
          sourceId: 'next-character',
          characterProfile: {
            ...source.characterProfile,
            interaction: { ...presenceRaw.characterProfile.interaction, scenario: '雨后的茶亭里，主人请来客坐下。', greeting: '请坐，茶刚沏好。' },
            dialogueExemplars: [{ id: 'tea', user: '能在这里避雨吗？', character: '当然，快进茶亭坐吧。' }],
          },
        };
        await act(async () => {
          root.render(React.createElement(DesktopRendererBindingProvider, { bindings },
            React.createElement(SourceDetailView, {
              source: nextSource, loading: false, error: false,
              onOpenWorld: () => {}, onPrimaryAction: () => {},
            })));
        });
        assert.equal(sceneText(), '雨后的茶亭里，主人请来客坐下。');
        assert.equal(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent, '当然，快进茶亭坐吧。');
        assert.equal(document.querySelector('[data-testid="world-character-dialogue-user"] p')?.textContent, '能在这里避雨吗？');

        // A scene remains visible without dialogue; an absent scene leaves no empty block.
        await act(async () => {
          root.render(React.createElement(DesktopRendererBindingProvider, { bindings },
            React.createElement(SourceDetailView, {
              source: { ...nextSource, characterProfile: { ...nextSource.characterProfile, dialogueExemplars: [], interaction: { ...nextSource.characterProfile.interaction, greeting: null } } },
              loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {},
            })));
        });
        assert.ok(sceneText()?.includes('雨后的茶亭'));
        assert.equal(document.querySelector('[data-testid="world-character-dialogue-section"]'), null);
        await act(async () => {
          root.render(React.createElement(DesktopRendererBindingProvider, { bindings },
            React.createElement(SourceDetailView, {
              source: { ...nextSource, characterProfile: { ...nextSource.characterProfile, interaction: { ...nextSource.characterProfile.interaction, scenario: null } } },
              loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {},
            })));
        });
        assert.equal(document.querySelector('[data-testid="world-character-meeting-scene"]'), null);
      } finally {
        await act(async () => { root.unmount(); });
      }
    } finally {
      await changeLocale('en');
    }
  });
});
