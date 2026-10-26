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
    // The hero keeps the name only in the h1 title row; the sample dialogue's
    // speaker label below the hero is allowed to repeat it.
    const heroMarkup = markup.slice(0, markup.indexOf('data-testid="world-character-overview-columns"'));
    assert.doesNotMatch(heroMarkup, /<p class="[^"]*">同恕<\/p>/);
    assert.doesNotMatch(markup, /linear-gradient\(to top, rgba\(255,255,255,0\.32\)/);
    assert.match(markup, /添加为伙伴/);
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
    assert.doesNotMatch(markup, /添加为伙伴/);
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

    assert.match(markup, /正在添加…/);
    assert.match(markup, /disabled[^>]*data-primary-action="become_partner"/);
    assert.doesNotMatch(markup, /添加为伙伴/);
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
  assert.equal(source.characterProfile.milestones[0]?.summary, '舊臣推舉入翰林學士院，聲名甚廣。');
  assert.equal(source.characterProfile.interaction?.cadence, '語速平緩，聽感莊重');
  assert.doesNotMatch(visibleMarkup, /苏轼|文学领袖|后入翰林学士院|语速平缓/);
  assert.doesNotMatch(markup, /data-testid="world-character-hero-dynasty-badge"/);
});

test('world character hero shows the world pill, an age-qualified subtitle, and the voice preview row', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      worldName: '东南秋声',
      media: {external: { voiceSampleUrl: 'https://cdn.example.test/voice.wav' },
        assets: {
          voiceSample: {
            id: 'voice-1',
            kind: 'voiceSample',
            externalUrl: 'https://cdn.example.test/voice.wav',
            provider: 'EXTERNAL_URL',
            mimeType: 'audio/wav',
            width: null,
            height: null,
            durationSec: 23.4,
            sha256: 'sha-voice',
          },
        },
      },
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        role: '瓦舍说话艺人',
        ageDescription: '二十多岁',
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

    assert.match(markup, /data-testid="world-character-world-pill"/);
    assert.match(markup, /所在世界/);
    assert.match(markup, /东南秋声/);
    const description = /<p data-testid="world-character-hero-description"[^>]*>([^<]*)<\/p>/u.exec(markup)?.[1];
    assert.equal(description, '瓦舍说话艺人 · 二十多岁');
    assert.match(markup, /data-testid="world-character-hero-voice"/);
    assert.match(markup, /声音试听/);
    assert.match(markup, /· 23 秒/);
    assert.match(markup, /data-testid="world-character-voice-sample-audio"[^>]*src="https:\/\/cdn\.example\.test\/voice\.wav"/);
  } finally {
    await changeLocale('en');
  }
});

test('world character overview renders authored biography and dialogue without chat topic shortcuts', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        disposition: '机敏狡黠，口齿锋利而幽默风趣。',
        knowledgeTopics: ['临安瓦舍勾栏百戏规矩', '听客心理与逗趣包袱', '市井传奇与历代说话本子', '都城行铺生计与茶坊掌故', '额外话题'],
        dialogueExemplars: [
          {
            id: 'exemplar-1',
            user: '我荷包里只有几文零钱，听不了整本的大戏。',
            character: '瞧您说的，瓦舍里图的就是个市井热闹！',
          },
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
        onStartChat: () => {},
      }),
    );

    assert.match(markup, /data-testid="world-character-about-section"/);
    assert.match(markup, /关于欧阳德/);
    assert.doesNotMatch(markup, /人物介绍|>性格<|>语气<|>节奏</);
    assert.match(markup, /欧阳德，字崇一，号南野，谥文庄，江西泰和人。/);
    assert.match(markup, /data-testid="character-disposition"/);
    assert.match(markup, /机敏狡黠，口齿锋利而幽默风趣。/);
    assert.doesNotMatch(markup, /相遇场景|听听TA怎么说|换一段/);
    assert.match(markup, /士人交游圈：以师友、同僚、门生关系为纽带。/);
    const aboutStart = markup.indexOf('data-testid="world-character-about-section"');
    const aboutEnd = markup.indexOf('</section>', aboutStart);
    const aboutMarkup = markup.slice(aboutStart, aboutEnd);
    assert.doesNotMatch(aboutMarkup, /相遇场景|士人交游圈/);
    assert.equal(aboutMarkup.match(/<h2\b/gu)?.length, 1);
    assert.equal(aboutMarkup.match(/<p\b/gu)?.length, 2);
    assert.match(aboutMarkup, /<p data-testid="character-introduction"[^>]*>欧阳德，字崇一，号南野，谥文庄，江西泰和人。<\/p>/u);
    assert.match(aboutMarkup, /<p data-testid="character-disposition"[^>]*>机敏狡黠，口齿锋利而幽默风趣。<\/p>/u);
    const sceneStart = markup.indexOf('data-testid="world-character-meeting-scene"');
    assert.ok(sceneStart > aboutEnd);
    assert.ok(sceneStart < markup.indexOf('data-testid="world-character-dialogue-section"'));
    assert.match(markup, /data-testid="world-character-dialogue-section"/);
    assert.match(markup, /data-testid="world-character-dialogue-user"/);
    assert.match(markup, /我荷包里只有几文零钱，听不了整本的大戏。/);
    assert.match(markup, /data-testid="world-character-dialogue-character"/);
    assert.match(markup, /瞧您说的，瓦舍里图的就是个市井热闹！/);
    // The greeting stays available as the second sample, so the refresh control shows.
    assert.match(markup, /data-testid="world-character-dialogue-refresh"/);
    assert.match(markup, /再看一段/);
    assert.ok(markup.indexOf('data-testid="world-character-dialogue-refresh"') > markup.indexOf('data-testid="world-character-opening-line"'));
    assert.doesNotMatch(markup, /可以聊什么|world-character-topics-section|world-character-topic-chip/);
    assert.doesNotMatch(markup, /都城行铺生计与茶坊掌故/);
    assert.doesNotMatch(markup, /额外话题/);
  } finally {
    await changeLocale('en');
  }
});

test('world character dialogue hides the refresh control when only the greeting exists', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
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

    assert.match(markup, /data-testid="world-character-dialogue-section"/);
    assert.match(markup, /吾乃欧阳德，字崇一，号南野。/);
    assert.doesNotMatch(markup, /data-testid="world-character-dialogue-user"/);
    assert.doesNotMatch(markup, /data-testid="world-character-dialogue-refresh"/);
  } finally {
    await changeLocale('en');
  }
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
