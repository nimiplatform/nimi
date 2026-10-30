import assert from 'node:assert/strict';
import test from 'node:test';

import {
  React,
  SourceDetailView,
  changeLocale,
  initI18n,
  liBaiRaw,
  ouYangDeRaw,
  renderToStaticMarkup,
  toSourceDetailData,
} from './source-detail-world-character-test-utils.js';

test.before(async () => {
  await initI18n();
});

test('world character source detail uses the shared character page surface', () => {
  const source = toSourceDetailData(liBaiRaw, 'source_materialization_available');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: { friendsCount: 2, postsCount: 3, likesCount: 5 },
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
    }),
  );

  assert.match(markup, /data-testid="character-source-detail-page"/);
  assert.match(markup, /data-source-kind="worldCharacter"/);
  assert.match(markup, /data-testid="world-character-works-section"/);
  // The hero follows the presence layout: no social stats grid above the
  // actions; the primary action sits on the hero's right side.
  assert.doesNotMatch(markup, /data-testid="world-character-hero-stats"/);
  assert.match(markup, /data-testid="world-character-hero-actions"/);
  assert.doesNotMatch(markup, /data-testid="world-character-bottom-stats"/);
  assert.doesNotMatch(markup, /data-testid="world-character-source-boundary"/);
  assert.doesNotMatch(markup, /data-testid="source-detail-compact-profile-card"/);
});

test('persona character source detail shares the profile surface and omits unavailable works', () => {
  const source = toSourceDetailData({
    ...liBaiRaw,
    id: 'persona-li-bai',
    sourceKind: 'personaCharacter',
    sourceId: 'persona-li-bai',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'persona-li-bai',
      worldId: liBaiRaw.worldId,
      ownerAccountId: 'account-li-bai',
      sourceHash: liBaiRaw.sourceHash,
    },
    source: undefined,
    characterProfile: {
      ...liBaiRaw.characterProfile,
      milestones: [],
      interaction: {
        tone: '豪放',
        cadence: '从容',
        scenario: '诗文问答',
        greeting: '且饮一杯，再谈诗。',
      },
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

  assert.match(markup, /data-testid="character-source-detail-page"/);
  assert.match(markup, /data-source-kind="personaCharacter"/);
  assert.doesNotMatch(markup, /data-testid="world-character-works-section"/);
  assert.doesNotMatch(markup, /No works are available yet/);
  assert.match(markup, /data-testid="world-character-dialogue-section"/);
  assert.match(markup, /且饮一杯，再谈诗。/);
});

test('persona character source detail localizes style fields without the profile disclosure', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...liBaiRaw,
      id: 'persona-qilan',
      displayName: '栖澜',
      handle: 'qilan-indexer',
      sourceKind: 'personaCharacter',
      sourceId: 'persona-qilan',
      sourceRef: {
        kind: 'personaCharacter',
        id: 'persona-qilan',
        worldId: liBaiRaw.worldId,
        ownerAccountId: 'account-owner',
        sourceHash: liBaiRaw.sourceHash,
      },
      source: undefined,
      characterProfile: {
        ...liBaiRaw.characterProfile,
        role: 'INTELLECTUAL',
        archetype: 'INTELLECTUAL',
        traits: ['DIRECT', 'GENTLE', 'WISE'],
        knowledgeTopics: [],
        interactionModes: ['conversation'],
        milestones: [],
        conversationAnchors: [],
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
    assert.doesNotMatch(markup, /world-character-identity-coordinates/);
    assert.match(markup, /理智型/);
    assert.doesNotMatch(markup, /world-character-profile-details/);
    assert.doesNotMatch(markup, /INTELLECTUAL|DIRECT|GENTLE|WISE/);
    assert.doesNotMatch(markup, /conversation/);
  } finally {
    await changeLocale('en');
  }
});

test('world character source detail keeps section titles without eyebrow labels', async () => {
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

    assert.doesNotMatch(markup, /人物速览/);
    assert.doesNotMatch(markup, /生涯节点/);
    assert.match(markup, /作品/);
    assert.match(markup, /生活与工作/);
    assert.doesNotMatch(markup, /人物关系|关系线索/);
    assert.doesNotMatch(markup, /形象与声音/);
    assert.doesNotMatch(markup, /人物档案/);
    assert.doesNotMatch(markup, /相关阅读/);
    assert.doesNotMatch(markup, /人物生平/);
    assert.doesNotMatch(markup, /图谱证据/);
    assert.doesNotMatch(markup, />形象<\/p>/);
  } finally {
    await changeLocale('en');
  }
});

test('world character source detail reuses the shared dossier projection', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');

  assert.equal(detail.characterProfile.role, '阳明学派思想家与朝廷重臣');
  assert.equal(detail.characterProfile.archetype, '阳明学派');
  assert.deepEqual(detail.characterProfile.traits, ['礼部尚书']);
  assert.deepEqual(detail.characterProfile.interactionModes, ['文人交游', '仕途回顾', '亲缘关系']);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.title), [
    '嘉靖二年（1523）中进士',
    '官至礼部尚书',
  ]);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.timeLabel), [
    '1523',
    '1554',
  ]);
  assert.equal(detail.characterProfile.milestones[1]?.kind, 'biography');
  assert.equal(detail.characterProfile.milestones[1]?.derived, false);
  assert.doesNotMatch(detail.characterProfile.milestones[1]?.summary ?? '', /掌管国家礼仪与科举事务/);
  assert.equal(detail.characterProfile.relationshipNotes[0]?.summary, '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。');
  assert.match(detail.characterProfile.conversationAnchors.join('\n'), /想问诗文、仕途还是人生起落/);
});

test('world character profile page omits question suggestions and nests the sample dialogue inside the overview', async () => {
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
        onStartChat: () => {},
      }),
    );

    assert.doesNotMatch(markup, /data-testid="world-character-question-suggestions"/);
    assert.doesNotMatch(markup, /data-testid="world-character-profile-details"/);
    assert.doesNotMatch(markup, /data-testid="world-character-question"/);
    assert.doesNotMatch(markup, /你可以问他/);
    const overviewStart = markup.indexOf('data-testid="world-character-overview-section"');
    const dialogueStart = markup.indexOf('data-testid="world-character-dialogue-section"');
    assert.ok(overviewStart !== -1, 'overview section should render');
    assert.ok(dialogueStart !== -1, 'sample dialogue should render');
    assert.ok(
      overviewStart < dialogueStart,
      'sample dialogue should be nested inside the overview section',
    );
  } finally {
    await changeLocale('en');
  }
});

test('shared character detail renders explicit age and disposition without reading trait prose', () => {
  const source = toSourceDetailData({ ...liBaiRaw, characterProfile: { ...liBaiRaw.characterProfile, disposition: '自负豪迈而敏感。', ageDescription: '四十多岁', speciesDescription: '人类', bodyDescription: '普通人类身体', lifeStageDescription: '成年' } }, 'source_materialization_available');
  const markup = renderToStaticMarkup(React.createElement(SourceDetailView, { source, loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {} }));
  assert.match(markup, /data-testid="character-disposition"/);
  assert.match(markup, /自负豪迈而敏感/);
  assert.match(markup, /四十多岁/);

  // Missing prose must never be filled from voice directions or identity tags.
  const renderAbout = (candidate: typeof source) => renderToStaticMarkup(React.createElement(SourceDetailView, {
    source: candidate, loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {},
  }));
  const onlyIntroduction = renderAbout({ ...source, characterProfile: { ...source.characterProfile, disposition: '   ' } });
  assert.match(onlyIntroduction, /data-testid="character-introduction"/);
  assert.doesNotMatch(onlyIntroduction, /data-testid="character-disposition"/);
  const onlyDisposition = renderAbout({ ...source, entity: null, bio: '   ' });
  assert.doesNotMatch(onlyDisposition, /data-testid="character-introduction"/);
  assert.match(onlyDisposition, /data-testid="character-disposition"/);
  const noProse = renderAbout({
    ...source, entity: null, bio: null,
    characterProfile: {
      ...source.characterProfile, disposition: null,
      interaction: { tone: '豪放', cadence: '从容', scenario: null, greeting: null },
    },
  });
  assert.doesNotMatch(noProse, /data-testid="world-character-about-section"/);
});

test('the profile uses full narrative and authored motives while absent sections stay hidden', () => {
  const source = toSourceDetailData({ ...liBaiRaw, entity: null, bio: 'A short discovery line.',
    characterProfile: { ...liBaiRaw.characterProfile, narrativeSummary: 'An octopus keeps every letter safe until its recipient is ready.',
      speciesDescription: 'Octopus', ageDescription: 'Adult', drives: ['Keep the letters dry.'], boundaries: ['Never promises delivery dates.'],
      bodyDescription: null, lifeStageDescription: null, disposition: null, role: null, archetype: null,
      knowledgeTopics: [], knowledgeConstraints: [], milestones: [], relationshipNotes: [], interaction: null, dialogueExemplars: [] },
    relationships: [],
  }, 'source_materialization_available');
  const render = (candidate: typeof source) => renderToStaticMarkup(React.createElement(SourceDetailView, {
    source: candidate, loading: false, error: false, onOpenWorld: () => {}, onPrimaryAction: () => {},
  }));
  const markup = render(source);
  assert.match(markup, /An octopus keeps every letter safe/);
  assert.doesNotMatch(markup, /A short discovery line/);
  assert.match(markup, /Adult · Octopus/);
  assert.match(markup, /Keep the letters dry/);
  assert.match(markup, /Never promises delivery dates/);
  assert.doesNotMatch(markup, /world-character-dialogue-section|world-character-appearance-disclosure|world-character-relationship-clues-section/);
  const empty = render({ ...source, bio: null, characterProfile: { ...source.characterProfile, narrativeSummary: null, drives: [], boundaries: [] } });
  assert.doesNotMatch(empty, /world-character-overview-columns|world-character-drives-section|world-character-knowledge-section/);
});
