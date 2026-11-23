import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type {
  WorldCharacter,
  WorldDetailData,
  WorldHistoryBundle,
  WorldPeopleCatalogState,
  WorldPublicAssetsData,
  WorldSceneItem,
  WorldSemanticData,
} from '../src/shell/renderer/features/world/world-detail-types.js';

const sampleCharacter: WorldCharacter = {
  id: 'char-yan',
  name: '晏飒飒',
  handle: '@yansasa',
  bio: '风火轮式的冰原狂飙客。',
  role: '物资运输车手',
  faction: '恒温地堡',
  sourceRef: {
    kind: 'worldCharacter',
    worldEntityRef: {
      worldId: 'world-bunker',
      entityId: 'entity-yan',
    },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  importance: 'PRIMARY',
};

const sampleWorld: WorldDetailData = {
  id: 'world-bunker',
  name: '一墙之隔，零下六十度与红油沸腾',
  description: '零下六十度冰原下的地下恒温避难所。',
  setting: null,
  iconUrl: null,
  bannerUrl: null,
  type: 'CREATOR',
  status: 'PUBLIC',
  level: 1,
  levelUpdatedAt: null,
  characterCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  creatorId: 'creator-1',
  freezeReason: null,
  scoreA: 80,
  scoreC: 80,
  scoreE: 80,
  scoreEwma: 80,
  scoreQ: 80,
  time: { mode: 'static', label: null, currentWorldTime: null },
};

const sampleScenes: WorldSceneItem[] = [
  {
    id: 'scene-hotpot',
    name: '红油铜锅恒温餐厅',
    description: '地堡B3层最滚烫的心脏地带，恒温二十六度。八张紫铜炭火鸳鸯锅终日飘香，老电视循环播着怀旧相声，房梁挂满风干腊肠与红辣椒，是全堡居民在暴风雪之夜最舍不得离开的庇护所。',
    activeEntities: [
      { id: 'char-yan', kind: 'character', label: '晏飒飒', summary: '重复的角色条目不应再出现在场景要素中' },
      { id: 'entity-stove', kind: 'object', label: '紫铜鸳鸯锅', summary: '以地热余温与炭火双供热的常明炉灶。' },
    ],
    relatedCharacters: [sampleCharacter],
    relatedEvents: [
      {
        id: 'event-1',
        timelineSeq: 1,
        time: '极寒第三年冬',
        title: '第一口红油锅开张',
        tag: 'daily',
        description: '地堡首次实现二十六度恒温供暖，全堡聚餐。',
        level: 'PRIMARY',
        eventHorizon: 'PAST',
        summary: '地堡首次在严冬聚餐庆祝。',
        locationRefs: ['scene-hotpot'],
        characterRefs: ['char-yan'],
        evidenceRefs: [],
        confidence: 1,
        needsEvidence: false,
      },
    ],
    relatedResources: [
      {
        id: 'char-yan',
        kind: 'character',
        title: '晏飒飒',
        summary: null,
        entityRefs: ['char-yan'],
        eventRefs: [],
      },
      {
        id: 'event-1',
        kind: 'event',
        title: '第一口红油锅开张',
        summary: '地堡首次在严冬聚餐庆祝。',
        entityRefs: [],
        eventRefs: ['event-1'],
      },
      {
        id: 'res-slug',
        kind: 'relationship',
        title: 'forensic-leverage',
        summary: '地堡冬季暗线约定，隐藏内部英文标识只展示正文。',
        entityRefs: [],
        eventRefs: [],
      },
      {
        id: 'res-menu',
        kind: 'note',
        title: '地堡冬季配给菜单',
        summary: '每周五凭工分兑换牛油底料与鲜冻蔬菜。',
        entityRefs: [],
        eventRefs: [],
      },
    ],
    counts: {
      activeEntityCount: 2,
      relatedCharacterCount: 1,
      relatedEventCount: 1,
      relatedResourceCount: 1,
    },
    media: [],
  },
  {
    id: 'scene-airlock',
    name: '零下六十度防爆气闸哨口',
    description: '隔绝生死的三十厘米厚防爆钢门与三段式消杀走廊。外侧结着幽蓝冰棱、风啸如鬼哭，内侧热风呼啸并挂着醒目的“没绝活免敲门”红铁皮告示。',
    activeEntities: [],
    relatedCharacters: [],
    relatedEvents: [],
    relatedResources: [],
    counts: {
      activeEntityCount: 0,
      relatedCharacterCount: 0,
      relatedEventCount: 0,
      relatedResourceCount: 0,
    },
    media: [],
  },
];

const emptyHistory: WorldHistoryBundle = { items: [], summary: null };
const emptySemantic: WorldSemanticData = {
  operationRules: [],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: false,
};

const readyPeopleCatalog: WorldPeopleCatalogState = {
  status: 'ready',
  offline: false,
  totalCount: 1,
  hasMore: false,
  loadingMore: false,
  loadMorePaused: false,
  loadMoreFailed: false,
  query: '',
  onQueryChange: () => {},
  onLoadMore: () => {},
  onRetry: () => {},
};

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
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
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    dom,
    restore: () => {
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('scene cards expose full scene details in a keyboard-navigable dialog with prev/next controls and focus return', async () => {
  const env = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { WorldDetailPage } = await import('../src/shell/renderer/features/world/world-detail-template.js');
  await initI18n();
  await changeLocale('en');
  const document = env.dom.window.document;
  const root = createRoot(document.getElementById('root')!);
  const publicAssets: WorldPublicAssetsData = {
    scenes: sampleScenes,
    resourceRefs: [],
    externalRefs: [],
    intents: [],
  };
  const viewedCharacters: WorldCharacter[] = [];
  const dialog = () => document.querySelector('[role="dialog"][aria-hidden="false"]');
  const settleClose = async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  try {
    await act(async () => {
      root.render(
        <WorldDetailPage
          world={sampleWorld}
          characters={[sampleCharacter]}
          peopleCharacters={[sampleCharacter]}
          peopleCatalog={readyPeopleCatalog}
          history={emptyHistory}
          semantic={emptySemantic}
          audits={[]}
          publicAssets={publicAssets}
          onViewCharacter={(character) => { viewedCharacters.push(character); }}
        />,
      );
    });

    const cards = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="world-scene-card"]')];
    assert.equal(cards.length, 2);
    assert.equal(cards[0]!.getAttribute('aria-haspopup'), 'dialog');
    assert.match(cards[0]!.textContent!, /View details/);

    cards[0]!.focus();
    await act(async () => { cards[0]!.click(); });

    assert.ok(dialog(), 'clicking a scene card opens the scene detail dialog');
    assert.equal(
      dialog()!.querySelector('[data-testid="world-scene-description"]')?.textContent,
      sampleScenes[0]!.description,
      'dialog renders the full scene description without truncation',
    );
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-counter"]')?.textContent, '1 / 2');
    assert.equal(dialog()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-prev"]')?.disabled, true);
    assert.equal(dialog()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-next"]')?.disabled, false);

    // Optional structured data renders cleanly without repeating linked characters inside active entities.
    const entitiesText = dialog()!.querySelector('[data-testid="world-scene-entities"]')?.textContent ?? '';
    assert.match(entitiesText, /紫铜鸳鸯锅/);
    assert.doesNotMatch(entitiesText, /重复的角色条目/);
    assert.match(dialog()!.querySelector('[data-testid="world-scene-events"]')?.textContent ?? '', /第一口红油锅开张/);
    assert.match(dialog()!.querySelector('[data-testid="world-scene-events"]')?.textContent ?? '', /地堡首次在严冬聚餐庆祝。/);
    assert.match(dialog()!.querySelector('[data-testid="world-scene-events"]')?.textContent ?? '', /地堡首次实现二十六度恒温供暖，全堡聚餐。/);
    const resourcesText = dialog()!.querySelector('[data-testid="world-scene-resources"]')?.textContent ?? '';
    assert.match(resourcesText, /地堡冬季配给菜单/);
    assert.match(resourcesText, /地堡冬季暗线约定，隐藏内部英文标识只展示正文。/);
    assert.doesNotMatch(resourcesText, /forensic-leverage/);
    assert.doesNotMatch(resourcesText, /晏飒飒/);
    assert.doesNotMatch(resourcesText, /第一口红油锅开张/);

    // Next button advances to scene 2, which omits empty optional sections.
    await act(async () => {
      dialog()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-next"]')!.click();
    });
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-counter"]')?.textContent, '2 / 2');
    assert.equal(
      dialog()!.querySelector('[data-testid="world-scene-description"]')?.textContent,
      sampleScenes[1]!.description,
    );
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-people"]'), null);
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-entities"]'), null);
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-events"]'), null);
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-resources"]'), null);
    assert.equal(dialog()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-next"]')?.disabled, true);

    // Keyboard ArrowLeft navigates back to scene 1.
    await act(async () => {
      env.dom.window.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    assert.equal(dialog()!.querySelector('[data-testid="world-scene-counter"]')?.textContent, '1 / 2');

    // Escape closes the dialog and returns focus to the triggering scene card.
    await act(async () => {
      document.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settleClose();
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, cards[0]);

    // Re-open scene 1 and click its related character to jump straight to that profile.
    await act(async () => { cards[0]!.click(); });
    const personButton = dialog()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-people"] button')!;
    assert.ok(personButton);
    await act(async () => { personButton.click(); });
    await settleClose();
    assert.equal(dialog(), null);
    assert.deepEqual(viewedCharacters.map((item) => item.id), ['char-yan']);
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});

test('single-scene worlds open the reader card without redundant prev/next controls', async () => {
  const env = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { WorldDetailPage } = await import('../src/shell/renderer/features/world/world-detail-template.js');
  await initI18n();
  await changeLocale('en');
  const document = env.dom.window.document;
  const root = createRoot(document.getElementById('root')!);

  try {
    await act(async () => {
      root.render(
        <WorldDetailPage
          world={sampleWorld}
          characters={[]}
          peopleCharacters={[]}
          peopleCatalog={{ ...readyPeopleCatalog, totalCount: 0 }}
          history={emptyHistory}
          semantic={emptySemantic}
          audits={[]}
          publicAssets={{
            scenes: [sampleScenes[1]!],
            resourceRefs: [],
            externalRefs: [],
            intents: [],
          }}
        />,
      );
    });
    const card = document.querySelector<HTMLButtonElement>('[data-testid="world-scene-card"]')!;
    await act(async () => { card.click(); });
    const dialog = document.querySelector('[role="dialog"][aria-hidden="false"]')!;
    assert.ok(dialog);
    assert.equal(dialog.querySelector('[data-testid="world-scene-prev"]'), null);
    assert.equal(dialog.querySelector('[data-testid="world-scene-next"]'), null);
    assert.equal(dialog.querySelector('[data-testid="world-scene-description"]')?.textContent, sampleScenes[1]!.description);
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});

test('selectDistinctSceneImageMedia hides world-shared and cross-scene duplicate artwork while keeping scene-specific images', async () => {
  const { selectDistinctSceneImageMedia } = await import('../src/shell/renderer/features/world/world-scene-viewer.js');
  const worldHeroAsset = {
    id: 'asset-hero',
    kind: 'highlight',
    mimeType: 'image/png',
    externalUrl: 'https://example.test/world-hero.png',
  } as WorldSceneItem['media'][number];
  const repeatedFallbackAsset = {
    id: 'asset-fallback',
    kind: 'highlight',
    mimeType: 'image/png',
    externalUrl: 'https://example.test/shared-fallback.png',
  } as WorldSceneItem['media'][number];
  const sceneSpecificAsset = {
    id: 'asset-scene-only',
    kind: 'highlight',
    mimeType: 'image/png',
    externalUrl: 'https://example.test/forensic-room.png',
  } as WorldSceneItem['media'][number];

  const scenes: WorldSceneItem[] = [
    { ...sampleScenes[0]!, media: [worldHeroAsset, repeatedFallbackAsset, sceneSpecificAsset] },
    { ...sampleScenes[1]!, media: [worldHeroAsset, repeatedFallbackAsset] },
  ];
  const sharedWorldKeys = new Set(['asset-hero', 'https://example.test/world-hero.png']);

  assert.deepEqual(
    selectDistinctSceneImageMedia(scenes[0]!, scenes, sharedWorldKeys).map((item) => item.id),
    ['asset-scene-only'],
  );
  assert.deepEqual(
    selectDistinctSceneImageMedia(scenes[1]!, scenes, sharedWorldKeys).map((item) => item.id),
    [],
  );
});

test('illustrated scene cards render distinct 3:2 plates, connected place links, and full-screen HD Lightbox navigation', async () => {
  const env = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { WorldDetailPage } = await import('../src/shell/renderer/features/world/world-detail-template.js');
  await initI18n();
  await changeLocale('en');
  const document = env.dom.window.document;
  const root = createRoot(document.getElementById('root')!);

  const illustratedScenes: WorldSceneItem[] = [
    {
      ...sampleScenes[0]!,
      spatial: { settingType: 'interior', connectedSceneIds: ['scene-airlock'] },
      media: [
        {
          id: 'res-hotpot-plate',
          kind: 'scene',
          purpose: 'scene_establishing',
          label: '红油铜锅恒温餐厅 · 空间主视图',
          mimeType: 'image/png',
          width: 1536,
          height: 1024,
          externalUrl: 'https://assets.example/hotpot-plate.png',
          delivery: null,
          provider: 'CF_R2',
          sha256: null,
          durationSec: null,
          provenance: { publicationId: null, publicationRecordId: null, ledgerRecordId: null },
        } as WorldSceneItem['media'][number],
      ],
    },
    {
      ...sampleScenes[1]!,
      spatial: { settingType: 'mixed', connectedSceneIds: ['scene-hotpot'] },
      media: [
        {
          id: 'res-airlock-plate',
          kind: 'scene',
          purpose: 'scene_establishing',
          label: '零下六十度防爆气闸哨口 · 空间主视图',
          mimeType: 'image/png',
          width: 1536,
          height: 1024,
          externalUrl: 'https://assets.example/airlock-plate.png',
          delivery: null,
          provider: 'CF_R2',
          sha256: null,
          durationSec: null,
          provenance: { publicationId: null, publicationRecordId: null, ledgerRecordId: null },
        } as WorldSceneItem['media'][number],
      ],
    },
  ];

  const lookups: string[] = [];
  const bindings = {
    sdk: { realm: () => ({ worldPublic: {
      async worldPublicControllerGetWorldScene({ path }: { path: { worldId: string; sceneId: string } }) {
        assert.equal(path.worldId, sampleWorld.id);
        lookups.push(path.sceneId);
        const preview = illustratedScenes.find((scene) => scene.id === path.sceneId)!.media[0]!;
        const url = `https://assets.example/${path.sceneId}/hero.webp`;
        return { ...path, media: [{ ...preview, externalUrl: null, delivery: {
          resourceId: preview.id, contentVersion: 'a'.repeat(64), publicationGeneration: 1,
          policyVersion: 'v2', originalUrl: `https://assets.example/${path.sceneId}/original.bin`,
          images: [{ purpose: 'hero', families: [{ mimeType: 'image/webp',
            sources: [{ url, width: 1536, height: 1024, mimeType: 'image/webp' }] }] }],
        } }] };
      },
    } }) },
  };
  try {
    await act(async () => {
      root.render(
        <DesktopRendererBindingProvider bindings={bindings as never}>
          <WorldDetailPage
          world={sampleWorld}
          characters={[sampleCharacter]}
          peopleCharacters={[sampleCharacter]}
          peopleCatalog={readyPeopleCatalog}
          history={emptyHistory}
          semantic={emptySemantic}
          audits={[]}
          publicAssets={{
            scenes: illustratedScenes,
            resourceRefs: [],
            externalRefs: [],
            intents: [],
          }}
          />
        </DesktopRendererBindingProvider>,
      );
    });

    const cardMediaFrames = [...document.querySelectorAll('[data-testid="world-scene-card-media"]')];
    assert.equal(cardMediaFrames.length, 2, 'each illustrated scene card renders its dedicated 3:2 plate');
    const cards = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="world-scene-card"]')];
    assert.match(cards[0]!.textContent ?? '', /Interior/);
    assert.match(cards[1]!.textContent ?? '', /Semi-open/);

    // Open scene 1 viewer.
    await act(async () => { cards[0]!.click(); });
    const viewer = () => document.querySelector('[data-testid="world-scene-viewer"]');
    assert.ok(viewer(), 'scene viewer dialog opens');
    assert.ok(viewer()!.querySelector('[data-testid="world-scene-media-enlarge"]'), 'scene plate is clickable to enlarge');

    // Click connected place chip to jump to scene 2.
    const connectedBtn = viewer()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-connected"] button');
    assert.ok(connectedBtn, 'connected place chip is rendered');
    assert.match(connectedBtn.textContent ?? '', /零下六十度防爆气闸哨口/);
    await act(async () => { connectedBtn.click(); });
    assert.equal(viewer()!.querySelector('[data-testid="world-scene-counter"]')?.textContent, '2 / 2');

    // Click enlarge to open HD Lightbox, step to previous scene plate, then close Lightbox.
    const enlargeBtn = viewer()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-media-enlarge"]')!;
    assert.deepEqual(lookups, [], 'scene previews do not request full-size media');
    enlargeBtn.focus();
    await act(async () => { enlargeBtn.click(); });
    const lightbox = () => document.querySelector('[data-testid="world-scene-lightbox"]');
    assert.ok(lightbox(), 'full-screen scene HD Lightbox opens');
    assert.match(lightbox()!.textContent ?? '', /2 \/ 2/);

    assert.deepEqual(lookups, ['scene-airlock']);
    assert.equal(lightbox()!.querySelector('img')?.src, 'https://assets.example/scene-airlock/hero.webp');

    // Exhaust the full-size image's retry without losing its preview or disabling navigation.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const image = lightbox()!.querySelector('img');
      assert.ok(image);
      await act(async () => { image.dispatchEvent(new env.dom.window.Event('error')); });
    }
    assert.equal(lightbox()!.querySelector('[role="status"]')?.textContent, 'This image could not be loaded.');
    assert.ok(viewer()!.querySelector('[data-testid="world-scene-media-enlarge"] img'));

    const prevBtn = lightbox()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-lightbox-prev"]')!;
    await act(async () => { prevBtn.click(); });
    assert.match(lightbox()!.textContent ?? '', /1 \/ 2/);
    assert.match(lightbox()!.textContent ?? '', /红油铜锅恒温餐厅/);

    assert.equal(lightbox()!.querySelector('img')?.alt, illustratedScenes[0]!.name);

    assert.deepEqual(lookups, ['scene-airlock', 'scene-hotpot']);
    const originalButton = [...lightbox()!.querySelectorAll('button')].find((button) => button.textContent === 'View original image');
    assert.ok(originalButton);
    await act(async () => { originalButton.click(); });
    assert.equal(lightbox()!.querySelector('img')?.src, 'https://assets.example/scene-hotpot/original.bin');

    const closeBtn = lightbox()!.querySelector<HTMLButtonElement>('[data-testid="world-scene-lightbox-close"]')!;
    await act(async () => { closeBtn.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
    assert.equal(lightbox(), null, 'closing Lightbox dismisses only the Lightbox');
    assert.ok(viewer(), 'parent WorldSceneViewer remains open after closing Lightbox');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(enlargeBtn.isConnected, false, 'the original scene trigger was replaced');
    assert.equal(document.activeElement, viewer()!.querySelector('[data-testid="world-scene-media-enlarge"]'),
      'closing restores focus to the preview for the last viewed image');
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.restore();
  }
});
