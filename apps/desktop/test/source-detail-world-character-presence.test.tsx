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

test('character gallery contains keyboard focus and returns it to the selected thumbnail', async () => {
  await withDom(async ({ window }) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n } = await import('../src/shell/renderer/i18n/index.ts');
    const { CharacterVisualGallery } = await import('../src/shell/renderer/features/source-detail/source-detail-character-gallery.js');
    const { toSourceDetailData } = await import('../src/shell/renderer/features/source-detail/source-detail-model.js');
    const { ouYangDeRaw } = await import('./source-detail-world-character-test-utils.js');
    await initI18n();
    const first = 'https://cdn.example.test/portrait-one.png';
    const second = 'https://cdn.example.test/portrait-two.png';
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      referenceImageUrls: [first, second],
    }, 'source_materialization_available');
    const { document } = window;
    const root = createRoot(document.getElementById('root')!);
    const dialog = () => document.querySelector('[role="dialog"]');
    const press = (key: string, shiftKey = false) => act(async () => {
      document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', {
        key, shiftKey, bubbles: true, cancelable: true,
      }));
    });
    try {
      await act(async () => {
        root.render(<CharacterVisualGallery characterName={source.displayName} items={source.visualGallery} />);
      });
      const thumbnails = document.querySelectorAll<HTMLButtonElement>('[data-testid="world-character-visual-gallery"] button');
      assert.equal(thumbnails.length, 2);
      const trigger = thumbnails[1]!;
      trigger.focus();
      await act(async () => { trigger.click(); });

      const close = dialog()?.querySelector<HTMLButtonElement>('[data-testid="world-character-gallery-lightbox-close"]');
      const next = dialog()?.querySelector<HTMLButtonElement>('[data-testid="world-character-gallery-lightbox-next"]');
      assert.ok(close && next);
      assert.equal(document.activeElement, close);
      assert.equal(dialog()?.querySelector('img')?.src, second);
      await press('ArrowRight');
      assert.equal(dialog()?.querySelector('img')?.src, first);
      await press('Tab', true);
      assert.equal(document.activeElement, next);
      await press('Tab');
      assert.equal(document.activeElement, close);

      await press('Escape');
      for (let attempt = 0; attempt < 20 && document.activeElement !== trigger; attempt += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      }
      assert.equal(dialog(), null);
      assert.equal(document.activeElement, trigger);
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});

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
        const stageColumn = document.querySelector('[data-testid="world-character-stage-column"]');
        const dossierColumn = document.querySelector('[data-testid="world-character-dossier-column"]');
        assert.ok(stageColumn?.querySelector('[data-testid="world-character-about-section"]'));
        assert.ok(stageColumn?.querySelector('[data-testid="world-character-interaction-stage"]'));
        assert.ok(dossierColumn?.querySelector('[data-testid="world-character-life-clues-section"]'));
        assert.equal(document.querySelectorAll('[data-testid="world-character-relationship-clues-section"]').length, 0);
        assert.equal(document.querySelector('[data-testid="world-character-topics-section"]'), null);
        assert.equal(document.querySelector('[data-testid="world-character-topic-chip"]'), null);

        // First sample is the authored exemplar pair.
        assert.match(document.querySelector('[data-testid="world-character-dialogue-user"]')?.textContent ?? '', /我荷包里只有几文零钱/);
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /瞧您说的/);

        const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        assert.equal(tabs.length, 2);
        assert.equal(tabs[0].textContent, '初遇招呼');
        assert.equal(tabs[1].textContent, '片段 1');
        await act(async () => { tabs[0].click(); });
        assert.equal(document.querySelector('[data-testid="world-character-dialogue-user"]'), null);
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /吾乃欧阳德/);
        assert.equal(sceneText(), initialScene);
        assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
        await act(async () => { tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
        assert.equal(document.activeElement, tabs[1]);
        assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
        assert.match(document.querySelector('[data-testid="world-character-opening-line"]')?.textContent ?? '', /瞧您说的/);
        assert.equal(sceneText(), initialScene);

        // The banner world pill opens the hosting world.
        const pill = document.querySelector<HTMLButtonElement>('[data-testid="world-character-world-pill"]');
        assert.ok(pill);
        await act(async () => { pill.click(); });
        assert.equal(worldOpened, 1);

        // Changing the source replaces the shared scene and starts its first sample.
        await act(async () => { tabs[0].click(); });
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

test('related characters start compact and keep all relationships and details reachable', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale, ouYangDeRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
    const { WorldCharacterRelationshipCluesSection } = await import('../src/shell/renderer/features/source-detail/source-detail-world-character-relationship-clues.js');
    await initI18n();
    await changeLocale('zh');
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.characterProfile.relationshipNotes = [];
    source.relationshipClues = Array.from({ length: 6 }, (_, index) => ({
      id: `friend-${index}`, type: 'association', label: '赠诗', targetEntityId: `person-${index}`,
      targetLabel: `友人${index}`, summary: `与友人${index}有诗文往来。`, details: [`详细记录${index}`],
    }));
    source.relationshipTargets = Object.fromEntries(source.relationshipClues.map(item => [
      item.targetEntityId!, { kind: 'person', name: item.targetLabel! },
    ]));
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => { root.render(<WorldCharacterRelationshipCluesSection source={source} />); });
      const document = dom.window.document;
      const rows = () => document.querySelectorAll('[data-testid="world-character-relationship-list"] > li');
      const toggle = () => document.querySelector<HTMLButtonElement>('button')!;
      assert.equal(rows().length, 4);
      assert.equal(toggle().textContent, '查看全部 6 条关系');
      assert.equal(toggle().getAttribute('aria-expanded'), 'false');
      const first = rows()[0].querySelector('details')!;
      assert.equal(first.open, false);
      await act(async () => { first.querySelector('summary')!.click(); });
      assert.equal(first.open, true);
      assert.match(first.textContent ?? '', /详细记录0/);
      await act(async () => { toggle().click(); });
      assert.equal(rows().length, 6);
      assert.equal(toggle().getAttribute('aria-expanded'), 'true');
      const last = rows()[5].querySelector('details')!;
      await act(async () => { last.querySelector('summary')!.click(); });
      assert.equal(last.open, true);
      assert.match(last.textContent ?? '', /详细记录5/);
      await act(async () => { toggle().click(); });
      assert.equal(rows().length, 4);
      await act(async () => { toggle().click(); });
      await act(async () => { root.render(<WorldCharacterRelationshipCluesSection source={{ ...source, id: 'another-character' }} />); });
      assert.equal(rows().length, 4);
      assert.equal(rows()[0].querySelector('details')!.open, false);
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});

test('conflicting partner inventory offers no creation or arbitrary selection', async () => {
  await withDom(async (dom) => {
    const { ouYangDeRaw } = await import('./source-detail-world-character-test-utils.js');
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    const { toSourceDetailData } = await import('../src/shell/renderer/features/source-detail/source-detail-model.js');
    await initI18n();
    await changeLocale('zh');
    const root = createRoot(dom.window.document.getElementById('root')!);
    let actions = 0;
    try {
      await act(async () => root.render(React.createElement(SourceDetailView, {
        source: toSourceDetailData(ouYangDeRaw, 'local_agent_ambiguous'), loading: false, error: false,
        onOpenWorld: () => {}, onPrimaryAction: () => { actions++; },
      })));
      const action = dom.window.document.querySelector<HTMLButtonElement>('[data-primary-action="partner_ambiguous"]')!;
      assert.ok(action);
      assert.equal(action.disabled, true);
      await act(async () => action.click());
      assert.equal(actions, 0);
      assert.equal(dom.window.document.body.textContent?.includes('创建另一位伙伴'), false);
      assert.equal(dom.window.document.querySelector('[data-testid="character-choose-partner"]'), null);
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

test('short related characters without extra details omit inert disclosure chevrons', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale, ouYangDeRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
    const { WorldCharacterRelationshipCluesSection } = await import('../src/shell/renderer/features/source-detail/source-detail-world-character-relationship-clues.js');
    await initI18n();
    await changeLocale('zh');
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.characterProfile.relationshipNotes = [];
    source.relationshipClues = [
      { id: 'short-rel', type: 'ally', label: '盟友', targetEntityId: 'p-short', targetLabel: '短简介友人', summary: '一起值夜班的搭档。', details: [] },
      { id: 'rich-rel', type: 'colleague', label: '同事', targetEntityId: 'p-rich', targetLabel: '长详情同事', summary: '共同负责冷库巡检。', details: ['持有双钥授权。'] },
    ];
    source.relationshipTargets = {
      'p-short': { kind: 'person', name: '短简介友人' },
      'p-rich': { kind: 'person', name: '长详情同事' },
    };
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => { root.render(<WorldCharacterRelationshipCluesSection source={source} />); });
      const rows = dom.window.document.querySelectorAll('[data-testid="world-character-relationship-list"] > li');
      assert.equal(rows.length, 2);
      assert.equal(rows[0].querySelector('details'), null, 'short row without extra details should not render an inert disclosure');
      assert.ok(rows[1].querySelector('details'), 'row with extra details should render an expandable disclosure');
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});

test('voice preview surfaces transcript while playing and reports playback rejection', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale, ouYangDeRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
    const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    await initI18n();
    await changeLocale('zh');
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.voiceSample = {
      id: 'voice-transcript',
      previewUrl: 'https://cdn.example.test/voice.wav',
      originalUrl: null,
      durationSec: 12,
      transcript: '无影灯下少废话，先躺上验尸台。',
      previewText: null,
    };
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => {
        root.render(React.createElement(DesktopRendererBindingProvider, { bindings: { app: { projection: { resourceBaseUrl: () => '' } } } as never },
          React.createElement(SourceDetailView, { source, loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {} })));
      });
      const document = dom.window.document;
      const audio = document.querySelector<HTMLAudioElement>('[data-testid="world-character-voice-sample-audio"]')!;
      const playButton = document.querySelector<HTMLButtonElement>('[data-testid="world-character-voice-play-button"]')!;
      assert.equal(document.querySelector('[data-testid="world-character-voice-transcript"]'), null);
      await act(async () => { audio.dispatchEvent(new dom.window.Event('play')); });
      assert.match(document.querySelector('[data-testid="world-character-voice-transcript"]')?.textContent ?? '', /无影灯下少废话/);
      await act(async () => { audio.dispatchEvent(new dom.window.Event('pause')); });
      assert.equal(document.querySelector('[data-testid="world-character-voice-transcript"]'), null);

      Object.defineProperty(audio, 'play', { configurable: true, value: () => Promise.reject(new Error('decode failed')) });
      await act(async () => { playButton.click(); });
      assert.match(document.body.textContent ?? '', /语音试听加载失败/);
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});

test('sticky partner bar tracks the ScrollArea viewport top across titlebar offsets without missing slow scrolls', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale, ouYangDeRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
    const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
    const { SourceDetailView } = await import('../src/shell/renderer/features/source-detail/source-detail-view.js');
    await initI18n();
    await changeLocale('zh');
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    let primaryClicks = 0;
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => {
        root.render(React.createElement(DesktopRendererBindingProvider, { bindings: { app: { projection: { resourceBaseUrl: () => '' } } } as never },
          React.createElement(SourceDetailView, {
            source,
            loading: false,
            error: false,
            onOpenWorld: () => {},
            onPrimaryAction: () => { primaryClicks += 1; },
          })));
      });
      const document = dom.window.document;
      const viewport = document.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
      const sentinel = document.querySelector<HTMLDivElement>('[data-testid="world-character-hero-sentinel"]');
      assert.ok(viewport, 'ScrollArea viewport should mount');
      assert.ok(sentinel, 'hero sentinel should mount');

      const makeRect = (top: number, height: number): DOMRect => ({
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 960,
        width: 960,
        height,
        toJSON: () => ({}),
      });

      // Simulate desktop titlebar chrome offsetting the ScrollArea viewport 40px from window top.
      let viewportTop = 40;
      let sentinelTop = 420;
      viewport.getBoundingClientRect = () => makeRect(viewportTop, 680);
      sentinel.getBoundingClientRect = () => makeRect(sentinelTop, 1);

      await act(async () => { viewport.dispatchEvent(new dom.window.Event('scroll')); });
      assert.equal(document.querySelector('[data-testid="world-character-sticky-bar"]'), null);

      // Scroll smoothly so the sentinel leaves the ScrollArea viewport (bottom <= 40)
      // while remaining positive in window coordinates (top = 35 >= 0).
      sentinelTop = 35;
      await act(async () => { viewport.dispatchEvent(new dom.window.Event('scroll')); });
      const stickyBar = document.querySelector<HTMLDivElement>('[data-testid="world-character-sticky-bar"]');
      assert.ok(stickyBar, 'sticky bar must appear as soon as the sentinel crosses the ScrollArea viewport top');
      assert.match(stickyBar.parentElement?.className ?? '', /\bh-0\b/, 'sticky wrapper must occupy zero flow height to avoid shifting the sentinel');

      const stickyAction = stickyBar.querySelector<HTMLButtonElement>('[data-primary-action="become_partner"]');
      assert.ok(stickyAction);
      assert.match(stickyAction.textContent ?? '', /添加为伙伴/);
      await act(async () => { stickyAction.click(); });
      assert.equal(primaryClicks, 1);

      // Continue scrolling further down: sticky bar stays mounted.
      sentinelTop = -240;
      await act(async () => { viewport.dispatchEvent(new dom.window.Event('scroll')); });
      assert.ok(document.querySelector('[data-testid="world-character-sticky-bar"]'));

      // Scroll back up so the hero re-enters the ScrollArea viewport: sticky bar hides.
      sentinelTop = 45;
      await act(async () => { viewport.dispatchEvent(new dom.window.Event('scroll')); });
      assert.equal(document.querySelector('[data-testid="world-character-sticky-bar"]'), null);

      // Layout shift / chrome height change (e.g. window resize) recalculates visibility.
      viewportTop = 64;
      sentinelTop = 58;
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event('resize')); });
      assert.ok(document.querySelector('[data-testid="world-character-sticky-bar"]'));
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});

test('related characters render resolved portrait media and fall back to initials when unavailable', async () => {
  await withDom(async (dom) => {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale, ouYangDeRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
    const { WorldCharacterRelationshipCluesSection } = await import('../src/shell/renderer/features/source-detail/source-detail-world-character-relationship-clues.js');
    await initI18n();
    await changeLocale('zh');
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.characterProfile.relationshipNotes = [];
    source.relationshipTargets = {
      'char-lin': {
        kind: 'character',
        name: '林小棠',
        isCharacter: true,
        avatarUrl: 'https://cdn.example.test/lin-fallback.png',
        avatarMedia: {
          resourceId: 'res-lin-avatar',
          contentVersion: 'a'.repeat(64),
          policyVersion: 'p1',
          publicationGeneration: 1,
          expiresAt: null,
          originalUrl: null,
          previewUrl: null,
          video: null,
          images: [{
            purpose: 'avatar',
            families: [{
              mimeType: 'image/webp',
              sources: [{ url: 'https://cdn.example.test/lin-managed-128.webp', width: 128, height: 128, mimeType: 'image/webp' }],
            }],
          }],
        },
      },
      'person-no-avatar': {
        kind: 'person',
        name: '无头像友人',
      },
    };
    source.relationshipClues = [
      { id: 'rel-1', type: 'acquaintance', label: '相识', targetEntityId: 'char-lin', targetLabel: '林小棠', summary: '入职首周登记档案。', details: [] },
      { id: 'rel-2', type: 'ally', label: '盟友', targetEntityId: 'person-no-avatar', targetLabel: '无头像友人', summary: '共同巡夜。', details: [] },
    ];
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => { root.render(<WorldCharacterRelationshipCluesSection source={source} />); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      const rows = dom.window.document.querySelectorAll('[data-testid="world-character-relationship-list"] > li');
      assert.equal(rows.length, 2);
      const linImg = rows[0].querySelector<HTMLImageElement>('img');
      assert.ok(linImg, 'related character with avatarMedia should render an img element');
      assert.equal(linImg.getAttribute('alt'), '林小棠');
      assert.equal(linImg.getAttribute('src'), 'https://cdn.example.test/lin-managed-128.webp');
      assert.equal(rows[1].querySelector('img'), null, 'related person without avatar should not render an img element');
      assert.ok(rows[1].textContent?.includes('无'), 'related person without avatar should render initial fallback');
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
    }
  });
});

test('profile text hiding rules reject 1-line tails and tiny hidden remainders', async () => {
  const {
    PROFILE_TEXT_MIN_HIDDEN_UNITS,
    PROFILE_TEXT_MIN_OVERFLOW_LINES,
    shouldCollapseProfileText,
    textVisualUnits,
  } = await import('../src/shell/renderer/features/source-detail/source-detail-character-content.js');

  assert.equal(PROFILE_TEXT_MIN_OVERFLOW_LINES, 2);
  assert.equal(PROFILE_TEXT_MIN_HIDDEN_UNITS, 24);

  assert.equal(textVisualUnits('账本。'), 6);
  assert.equal(textVisualUnits('嗯。\n好。'), 8);
  assert.equal(textVisualUnits('small ledger.'), 12);
  assert.ok(textVisualUnits('口袋里永远揣着一本卷边的红蓝线物资小账本。') >= PROFILE_TEXT_MIN_HIDDEN_UNITS);

  const lineHeight = 22.1;
  // 4 lines and 5 lines (1 overflow line, even a full line or a 2-char tail) never collapse.
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 88, lineHeight, hiddenText: '' }), false);
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 111, lineHeight, hiddenText: '账本。' }), false);
  assert.equal(shouldCollapseProfileText({
    previewLines: 4,
    contentHeight: 111,
    lineHeight,
    hiddenText: '口袋里永远揣着一本卷边的红蓝线物资小账本。',
  }), false);

  // 6 lines (2 overflow lines) only collapses when hidden content is meaningful.
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 133, lineHeight, hiddenText: '嗯。\n好。' }), false);
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 133, lineHeight, hiddenText: '   \n\n' }), false);
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 133, lineHeight, hiddenText: 'small ledger.' }), false);
  assert.equal(shouldCollapseProfileText({
    previewLines: 4,
    contentHeight: 133,
    lineHeight,
    hiddenText: '口袋里永远揣着一本卷边的红蓝线物资小账本。',
  }), true);
  assert.equal(shouldCollapseProfileText({
    previewLines: 4,
    contentHeight: 133,
    lineHeight,
    hiddenText: 'and always carries a worn red-and-blue supply ledger in his pocket.',
  }), true);
  // Without Range geometry (e.g. JSDOM), falls back to the 2-line overflow threshold.
  assert.equal(shouldCollapseProfileText({ previewLines: 4, contentHeight: 133, lineHeight, hiddenText: null }), true);
});

test('CharacterProfileText only clamps above threshold and tracks resize, expand, and text changes', async () => {
  await withDom(async (dom) => {
    const callbacks = new Set<() => void>();
    class MockResizeObserver {
      private callback: () => void;
      constructor(cb: () => void) {
        this.callback = cb;
      }
      observe() {
        callbacks.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback);
      }
    }
    const previousResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });

    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
    const { CharacterProfileText } = await import('../src/shell/renderer/features/source-detail/source-detail-character-content.js');
    await initI18n();
    await changeLocale('zh');

    const baseText = '敦实魁梧，皮肤被风沙吹得粗糙黝黑，平头夹杂几丝白茬，一双粗厚大手满是机油老茧。常穿洗褪色的军绿色旧夹克，外扎宽皮带，腰间挂着七把叮当作响的黄铜钥匙，口袋里永远揣着一本卷边的红蓝线物资小账本。';
    const longText = `${baseText}每天清晨都会清点油桶与干粮，绝不让任何人浪费一点儿物资，嘴上骂得凶心里比谁都护短。`;

    let mockScrollHeight = 110; // 5 lines at 22px line-height
    let mockCutoffIndex = baseText.length - 3; // Only "账本。" below line 4

    const makeRect = (top: number, height: number): DOMRect => ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 290,
      width: 290,
      height,
      toJSON: () => ({}),
    });

    const originalCreateRange = dom.window.document.createRange.bind(dom.window.document);
    dom.window.document.createRange = () => {
      const range = originalCreateRange();
      let startOffset = 0;
      const origSetStart = range.setStart.bind(range);
      range.setStart = (node, offset) => {
        startOffset = offset;
        origSetStart(node, offset);
      };
      range.getBoundingClientRect = () => {
        const lineIndex = startOffset >= mockCutoffIndex ? 4 : 0;
        return makeRect(10 + lineIndex * 22, 17);
      };
      return range;
    };

    const originalGetComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      const style = originalGetComputedStyle(element, pseudo);
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'lineHeight') return '22px';
          if (prop === 'paddingTop' || prop === 'paddingBottom' || prop === 'borderTopWidth') return '0px';
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }) as typeof dom.window.getComputedStyle;

    const triggerResize = async () => {
      await act(async () => {
        for (const cb of callbacks) cb();
      });
    };

    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => {
        root.render(<CharacterProfileText testId="appearance-text" text={baseText} lines={4} />);
      });
      const p = dom.window.document.querySelector<HTMLParagraphElement>('[data-testid="appearance-text"]')!;
      assert.ok(p);
      Object.defineProperty(p, 'clientWidth', { configurable: true, get: () => 290 });
      Object.defineProperty(p, 'scrollHeight', { configurable: true, get: () => mockScrollHeight });
      p.getBoundingClientRect = () => makeRect(10, Math.min(mockScrollHeight, 88));

      // 5 lines (1 overflow line, only "账本。"): never clamped and no toggle button.
      await triggerResize();
      assert.equal(dom.window.document.querySelector('button'), null);
      assert.equal(p.style.overflow, '');

      // Even if scrollHeight reports 6 lines (e.g. short newline tail), tiny hidden tail ("账本。") stays unclamped.
      mockScrollHeight = 132;
      mockCutoffIndex = baseText.length - 3;
      await triggerResize();
      assert.equal(dom.window.document.querySelector('button'), null);
      assert.equal(p.style.overflow, '');

      // 7 lines with meaningful hidden content: clamps and shows "阅读全文".
      await act(async () => {
        root.render(<CharacterProfileText testId="appearance-text" text={longText} lines={4} />);
      });
      mockScrollHeight = 154;
      mockCutoffIndex = baseText.length - 7;
      await triggerResize();
      const readMore = dom.window.document.querySelector<HTMLButtonElement>('button');
      assert.ok(readMore, 'long overflowing text should render a toggle button');
      assert.equal(readMore.textContent, '阅读全文');
      assert.equal(readMore.getAttribute('aria-expanded'), 'false');
      assert.equal(p.style.overflow, 'hidden');

      // Clicking "阅读全文" expands and removes clamp.
      await act(async () => { readMore.click(); });
      assert.equal(readMore.textContent, '收起全文');
      assert.equal(readMore.getAttribute('aria-expanded'), 'true');
      assert.equal(p.style.overflow, '');

      // Widening the container while expanded drops below threshold and hides "收起全文".
      mockScrollHeight = 110;
      await triggerResize();
      assert.equal(dom.window.document.querySelector('button'), null);

      // Narrowing again re-enables collapsed preview cleanly (not stuck expanded).
      mockScrollHeight = 154;
      await triggerResize();
      const collapsedAgain = dom.window.document.querySelector<HTMLButtonElement>('button');
      assert.ok(collapsedAgain);
      assert.equal(collapsedAgain.textContent, '阅读全文');
      assert.equal(collapsedAgain.getAttribute('aria-expanded'), 'false');
      assert.equal(p.style.overflow, 'hidden');

      // Switching text prop while expanded resets expanded state.
      await act(async () => { collapsedAgain.click(); });
      assert.equal(collapsedAgain.textContent, '收起全文');
      await act(async () => {
        root.render(<CharacterProfileText testId="appearance-text" text={`${longText}补充一段细节。`} lines={4} />);
      });
      const afterTextChange = dom.window.document.querySelector<HTMLButtonElement>('button');
      assert.ok(afterTextChange);
      assert.equal(afterTextChange.textContent, '阅读全文');
      assert.equal(afterTextChange.getAttribute('aria-expanded'), 'false');
    } finally {
      await act(async () => { root.unmount(); });
      await changeLocale('en');
      if (previousResizeObserver) {
        Object.defineProperty(globalThis, 'ResizeObserver', previousResizeObserver);
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    }
  });
});
