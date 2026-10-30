import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';


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

test('world character sample tabs select exchanges with keyboard access and reset for a different source', async () => {
  await withDom(async (dom) => {
    const { ouYangDeRaw } = await import('./source-detail-world-character-test-utils.js');
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

        const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        assert.equal(tabs.length, 2);
        assert.equal(tabs[0].textContent, '片段 1');
        assert.equal(tabs[1].textContent, '初遇招呼');
        await act(async () => { tabs[1].click(); });
        assert.equal(document.querySelector('[data-testid="world-character-dialogue-user"]'), null);
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /吾乃欧阳德/);
        assert.equal(sceneText(), initialScene);
        assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
        await act(async () => { tabs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
        assert.equal(document.activeElement, tabs[0]);
        assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /瞧您说的/);
        assert.equal(sceneText(), initialScene);

        // The banner world pill opens the hosting world.
        const pill = document.querySelector<HTMLButtonElement>('[data-testid="world-character-world-pill"]');
        assert.ok(pill);
        await act(async () => { pill.click(); });
        assert.equal(worldOpened, 1);

        // Changing the source replaces the shared scene and starts its first sample.
        await act(async () => { tabs[1].click(); });
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

test('partner selection opens only the chosen existing partner and creating another stays explicit', async () => {
  await withDom(async (dom) => {
    const { ouYangDeRaw } = await import('./source-detail-world-character-test-utils.js');
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    const { toSourceDetailData } = await import('../src/shell/renderer/features/source-detail/source-detail-model.js');
    await initI18n();
    await changeLocale('zh');
    const root = createRoot(dom.window.document.getElementById('root')!);
    const selected: string[] = [];
    let created = 0;
    try {
      await act(async () => root.render(React.createElement(SourceDetailView, {
        source: toSourceDetailData(ouYangDeRaw, 'local_agent_ambiguous'), loading: false, error: false,
        onOpenWorld: () => {}, onPrimaryAction: () => { throw new Error('Ambiguous source must never pick automatically'); },
        partners: [
          { localAgentRef: 'partner-one', displayName: 'First', capturedAt: '2026-10-01T00:00:00Z' },
          { localAgentRef: 'partner-two', displayName: 'Second', capturedAt: '2026-10-02T00:00:00Z' },
        ],
        onSelectPartner: ref => selected.push(ref), onCreateAnother: () => { created++; },
      })));
      const document = dom.window.document;
      const choose = document.querySelector<HTMLButtonElement>('[data-testid="character-choose-partner"]')!;
      assert.ok(choose);
      assert.equal(document.body.textContent?.includes('Second'), false, 'the list starts collapsed');
      await act(async () => { choose.click(); });
      assert.deepEqual(selected, []);
      const second = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Second'));
      assert.ok(second);
      await act(async () => { second.click(); });
      assert.deepEqual(selected, ['partner-two']);
      const another = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '创建另一位伙伴');
      assert.ok(another);
      await act(async () => { another.click(); });
      assert.equal(created, 0, 'opening the explanation does not create a partner');
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '确认创建');
      assert.ok(confirm);
      await act(async () => { confirm.click(); });
      assert.equal(created, 1);
    } finally {
      await act(async () => root.unmount());
      await changeLocale('en');
    }
  });
});

test('first meeting selection changes the scene and its opening line together', async () => {
  await withDom(async (dom) => {
    const { ouYangDeRaw } = await import('./source-detail-world-character-test-utils.js');
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
    const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    const { toSourceDetailData } = await import('../src/shell/renderer/features/source-detail/source-detail-model.js');
    await initI18n();
    await changeLocale('zh');
    const scenes = [
      { sceneId: 'passage', title: '密道献宝', scenario: '他从送餐梯递来钥匙。', greeting: '钥匙备齐啦！' },
      { sceneId: 'ball', title: '舞会恶作剧', scenario: '他举起露台的灯光遥控器。', greeting: '好戏开场了！' },
      { sceneId: 'boat', title: '烟花下的快艇', scenario: '他扶你踏上快艇。', greeting: '手给我，甲板有点滑。' },
    ];
    const source = toSourceDetailData({ ...ouYangDeRaw, characterProfile: {
      ...ouYangDeRaw.characterProfile,
      dialogueExemplars: [],
      interaction: { ...ouYangDeRaw.characterProfile.interaction, meetingScenes: scenes },
    } }, 'source_materialization_available');
    const root = createRoot(dom.window.document.getElementById('root')!);
    const render = async (value: typeof source) => act(async () => {
      root.render(React.createElement(DesktopRendererBindingProvider, { bindings: { app: { projection: { resourceBaseUrl: () => '' } } } as never },
        React.createElement(SourceDetailView, { source: value, loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {} })));
    });
    try {
      await render(source);
      const document = dom.window.document;
      const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="world-character-meeting-tabs"] [role="tab"]')];
      const assertScene = (index: number) => {
        assert.equal(document.querySelector('[data-testid="world-character-meeting-scene"]')?.textContent, scenes[index].scenario);
        assert.equal(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent, scenes[index].greeting);
        assert.equal(document.querySelectorAll('[data-testid="world-character-opening-line"]').length, 1);
        assert.equal(tabs()[index].getAttribute('aria-selected'), 'true');
        assert.equal(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby'), tabs()[index].id);
      };
      assert.deepEqual(tabs().map(tab => tab.textContent), scenes.map(scene => scene.title));
      assertScene(0);
      await act(async () => { tabs()[1].click(); });
      assertScene(1);
      await act(async () => { tabs()[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      assertScene(2);
      assert.equal(document.activeElement, tabs()[2]);
      await act(async () => { tabs()[2].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
      assertScene(0);
      await act(async () => { tabs()[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
      assertScene(2);
      await render({ ...source, sourceId: 'another-character' });
      assertScene(0);
      // A single authored scene keeps its description and speech without redundant tabs.
      await render({ ...source, sourceId: 'single-scene', characterProfile: { ...source.characterProfile,
        interaction: { ...source.characterProfile.interaction!, meetingScenes: [scenes[2]] },
      } });
      assert.equal(tabs().length, 0);
      assert.equal(document.querySelector('[data-testid="world-character-meeting-scene"]')?.textContent, scenes[2].scenario);
      assert.equal(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent, scenes[2].greeting);
      // General dialogue examples retain a separate visible section, rather than
      // reading as another opening line belonging to the selected meeting.
      await render({ ...source, sourceId: 'with-examples', characterProfile: { ...source.characterProfile,
        dialogueExemplars: [{ id: 'example', user: '平时喜欢做什么？', character: '闲下来就去练鼓。' }],
      } });
      const examples = document.querySelector('[data-testid="world-character-dialogue-section"]')!;
      assert.equal(examples.querySelector('h2')?.textContent, '相处片段');
      await act(async () => { tabs()[2].click(); });
      const meeting = document.querySelector('[data-testid="world-character-first-meeting-section"]')!;
      assert.equal(meeting.querySelector('[data-testid="world-character-opening-line"]')?.textContent, scenes[2].greeting);
      assert.equal(examples.querySelector('[data-testid="world-character-opening-line"]')?.textContent, '闲下来就去练鼓。');
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});
