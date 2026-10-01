import assert from 'node:assert/strict';
import test from 'node:test';

import {
  React,
  SourceDetailView,
  changeLocale,
  initI18n,
  ouYangDeRaw,
  renderToStaticMarkup,
  toSourceDetailData,
} from './source-detail-world-character-test-utils.js';

test.before(async () => {
  await initI18n();
});

test('world character source detail hides generic system and affordance tags from the hero', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    tags: ['可交互身份'],
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );

  assert.doesNotMatch(markup, /世界实体/);
  assert.doesNotMatch(markup, />人物<\/span>/);
  assert.doesNotMatch(markup, /可交互身份/);
  assert.doesNotMatch(markup, /Interactive character/);
});

test('world character source detail renders authored labels without scene slugs or a guessed era badge', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      archetype: '元代文人网络',
    },
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );

  assert.doesNotMatch(markup, /yuan-literati-network/);
  assert.doesNotMatch(markup, /yuan-academy-gathering/);
  assert.doesNotMatch(markup, /yuan-official-court/);
  assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
  assert.doesNotMatch(markup, /元代/);
});

test('world character hero shows no era badge guessed from the archetype, no bottom white mask, and hides removed hero metadata copy', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '同恕',
      handle: '同恕',
      entity: {
        ...ouYangDeRaw.entity,
        name: '同恕',
      },
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        archetype: '元代文人网络',
      },
    }, 'source_materialization_available');
    const markup = renderToStaticMarkup(
      React.createElement(SourceDetailView, {
        source,
        stats: { friendsCount: 0, postsCount: 0, likesCount: 0 },
        loading: false,
        error: false,
        onBack: () => {},
        onOpenWorld: () => {},
        onPrimaryAction: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-character-hero-title-row"[\s\S]*同恕/);
    assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
    assert.doesNotMatch(markup, /元代/);
    assert.doesNotMatch(markup, /<p class="[^"]*">同恕<\/p>/);
    assert.doesNotMatch(markup, /linear-gradient\(to top, rgba\(255,255,255,0\.32\)/);
    assert.match(markup, /加入我的角色/);
    assert.doesNotMatch(markup, /立即对话/);
    assert.doesNotMatch(markup, /加入后可在本地持续对话/);
    assert.doesNotMatch(markup, /当前身份/);
    assert.doesNotMatch(markup, /身份标签/);
    assert.doesNotMatch(markup, /添加到我的角色/);
  } finally {
    await changeLocale('en');
  }
});

test('world character hero shows chat instead of join after the character is already in my roles', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '同恕',
      handle: '同恕',
      entity: {
        ...ouYangDeRaw.entity,
        name: '同恕',
      },
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        archetype: '元代文人网络',
      },
    }, 'local_agent_available');
    const markup = renderToStaticMarkup(
      React.createElement(SourceDetailView, {
        source,
        stats: { friendsCount: 0, postsCount: 0, likesCount: 0 },
        loading: false,
        error: false,
        onBack: () => {},
        onOpenWorld: () => {},
        onPrimaryAction: () => {},
        onStartChat: () => {},
      }),
    );

    assert.match(markup, /立即对话/);
    assert.doesNotMatch(markup, /加入我的角色/);
    assert.doesNotMatch(markup, /打开伙伴/);
    assert.doesNotMatch(markup, /data-primary-action="open_partner"/);
  } finally {
    await changeLocale('en');
  }
});

test('world character hero shows a disabled joining state while the join is in flight', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '同恕',
      handle: '同恕',
      entity: {
        ...ouYangDeRaw.entity,
        name: '同恕',
      },
    }, 'source_materialization_available');
    const markup = renderToStaticMarkup(
      React.createElement(SourceDetailView, {
        source,
        stats: { friendsCount: 0, postsCount: 0, likesCount: 0 },
        loading: false,
        error: false,
        primaryActionJoining: true,
        onBack: () => {},
        onOpenWorld: () => {},
        onPrimaryAction: () => {},
      }),
    );

    assert.match(markup, /正在加入…/);
    assert.match(markup, /disabled[^>]*data-primary-action="become_partner"/);
    assert.doesNotMatch(markup, /加入我的角色/);
    assert.doesNotMatch(markup, /立即对话/);
  } finally {
    await changeLocale('en');
  }
});

test('world character hero keeps banner and avatar placement and shows the explicit role as authored', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '姚燧',
      handle: 'yao-sui',
      entity: {
        ...ouYangDeRaw.entity,
        id: 'cbdb-person-yao-sui',
        name: '姚燧',
        summary: '姚燧，字端甫，号牧庵，元代文学家、政治家。',
        contentHash: 'entity-hash-yao-sui',
      },
      bio: '元代文学家、政治家。',
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        role: '文学家，政治家',
        archetype: '元代文人网络',
        traits: ['翰林学士'],
        interactionModes: ['文人交游'],
      },
    }, 'source_materialization_available');
    const markup = renderToStaticMarkup(
      React.createElement(SourceDetailView, {
        source,
        stats: { friendsCount: 0, postsCount: 0, likesCount: 0 },
        loading: false,
        error: false,
        onBack: () => {},
        onOpenWorld: () => {},
        onPrimaryAction: () => {},
      }),
    );

    assert.doesNotMatch(markup, /data-testid="world-character-hero-identity"/);
    assert.match(markup, /data-testid="world-character-hero-title-row"[\s\S]*姚燧/);
    assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
    // The hero line is the explicit role; no era prefix is guessed from the
    // archetype and no courtesy or art name is parsed out of the summary.
    const description = /<p data-testid="world-character-hero-description"[^>]*>([^<]*)<\/p>/u.exec(markup)?.[1];
    assert.equal(description, '文学家，政治家');
    // The authored summary still renders unchanged in the overview.
    assert.match(markup, /姚燧，字端甫，号牧庵，元代文学家、政治家。/);
    assert.ok(
      markup.indexOf('data-testid="world-character-hero-avatar"') < markup.indexOf('data-testid="world-character-hero-title-row"'),
      'avatar should keep its original stacked placement before the name row',
    );
  } finally {
    await changeLocale('en');
  }
});

test('world character source detail renders admitted CBDB dossier prose as authored without script conversion', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '蘇軾',
    handle: 'su-shi',
    entity: {
      ...ouYangDeRaw.entity,
      name: '蘇軾',
      summary: '元代文學與關係網核心人物，後歷任翰林學士承旨，舊友往來甚廣。',
    },
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      role: '文學領袖與朝廷重臣',
      archetype: '元代文人關係網',
      traits: ['翰林學士承旨'],
      milestones: [
        {
          id: 'cbdb-person-traditional-milestone-1',
          title: '後入翰林學士院',
          summary: '舊臣推舉入翰林學士院，聲名甚廣。',
          sequence: 1,
          timeLabel: '1275',
          kind: 'biography',
          derived: false,
        },
      ],
      knowledgeTopics: ['文學與關係網', '舊友往來甚廣'],
      knowledgeConstraints: ['語氣沉穩，少談臺閣舊事'],
      interaction: {
        tone: '沉穩含蓄，談吐帶有舊學氣息',
        cadence: '語速平緩，聽感莊重',
        scenario: '元代文人關係網中的會面。',
        greeting: '吾乃蘇軾，願與諸君談文學與舊事。',
      },
    },
    relationships: [
      {
        id: 'cbdb-rel-traditional-status-1',
        type: 'status',
        sourceEntityId: 'cbdb-person-traditional',
        targetEntityId: 'cbdb-status-traditional',
        contentHash: 'rel-traditional-status-hash',
        core: {
          presentation: {
            summary: '蘇軾被標識為文學領袖，與元代文人關係網密切。',
          },
          attributes: {
            statusLabel: '文學領袖與關係網',
            rowRef: 'cbdb:STATUS_DATA:traditional:1',
            joinStatus: 'resolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  assert.equal(source.displayName, '蘇軾');
  assert.equal(source.entity?.summary, '元代文學與關係網核心人物，後歷任翰林學士承旨，舊友往來甚廣。');
  assert.equal(source.characterProfile.archetype, '元代文人關係網');
  assert.equal(source.characterProfile.milestones[0]?.title, '後入翰林學士院');

  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );
  const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');

  assert.match(visibleMarkup, /蘇軾/);
  assert.match(visibleMarkup, /元代文學與關係網核心人物，後歷任翰林學士承旨，舊友往來甚廣。/);
  assert.match(visibleMarkup, /文學領袖與朝廷重臣/);
  assert.match(visibleMarkup, /元代文人關係網/);
  assert.match(visibleMarkup, /後入翰林學士院/);
  assert.match(visibleMarkup, /舊臣推舉入翰林學士院，聲名甚廣。/);
  assert.match(visibleMarkup, /語速平緩，聽感莊重/);
  assert.doesNotMatch(visibleMarkup, /苏轼|文学领袖|后入翰林学士院|语速平缓/);
  assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
});

test('world character source detail removes facts panel and replaces breadcrumbs with back button', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    entity: {
      ...ouYangDeRaw.entity,
      facts: [
        { label: 'CBDB person id', value: '34968' },
        { label: 'source entity id', value: 'cbdb-person-34968' },
      ],
    },
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );

  assert.match(markup, /data-testid="world-character-back-button"/);
  assert.doesNotMatch(markup, /aria-label="Breadcrumb"/);
  assert.doesNotMatch(markup, /World atlas/);
  assert.doesNotMatch(markup, /People<\/button>/);
  assert.doesNotMatch(markup, /Additional notes/);
  assert.doesNotMatch(markup, /CBDB person id/);
  assert.doesNotMatch(markup, /source entity id/);
  assert.doesNotMatch(markup, /cbdb-person-34968/);
});
