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
import { composeWorldCharacterMilestones } from '../src/shell/renderer/features/source-detail/source-detail-world-character-milestones.js';

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
  assert.match(markup, /data-testid="world-character-hero-stats"/);
  assert.match(markup, /data-testid="world-character-hero-actions"/);
  assert.ok(
    markup.indexOf('data-testid="world-character-hero-actions"') > markup.indexOf('data-testid="world-character-hero-stats"'),
    'world character hero actions should render in the right-side rail below stats',
  );
  assert.doesNotMatch(markup, /data-testid="world-character-bottom-stats"/);
  assert.doesNotMatch(markup, /data-testid="world-character-source-boundary"/);
  assert.doesNotMatch(markup, /data-testid="source-detail-compact-profile-card"/);
});

test('persona character source detail uses the same shared profile and page surface', () => {
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
  assert.match(markup, /data-testid="world-character-works-section"/);
  assert.match(markup, /No works are available yet/);
  assert.match(markup, /data-testid="world-character-media-section"/);
  assert.match(markup, /且饮一杯，再谈诗。/);
});

test('persona character source detail preserves localized style fields in a disclosure', async () => {
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
    // The compact disclosure keeps the authored profile fields reachable.
    assert.match(markup, /理智型/);
    assert.match(markup, /直率.*温和.*睿智/);
    assert.match(markup, /world-character-profile-details/);
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

    assert.match(markup, /人物速览/);
    assert.match(markup, /生涯节点/);
    assert.match(markup, /作品/);
    assert.match(markup, /关系线索/);
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

test('world character source detail reuses the shared dossier and keeps career augmentation separate', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
  const milestones = composeWorldCharacterMilestones(
    detail.characterProfile.milestones,
    detail.worldCharacterAugmentation?.careerMilestones ?? [],
  );

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
  assert.equal(milestones[1]?.kind, 'office');
  assert.equal(milestones[1]?.derived, true);
  assert.match(milestones[1]?.summary ?? '', /掌管国家礼仪与科举事务/);
  assert.equal(detail.characterProfile.relationshipNotes[0]?.summary, '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。');
  assert.match(detail.characterProfile.conversationAnchors.join('\n'), /想问诗文、仕途还是人生起落/);
});

test('world character profile page keeps question suggestions and nests media inside the overview', async () => {
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

    assert.match(markup, /data-testid="world-character-question-suggestions"/);
    assert.doesNotMatch(markup, /data-testid="world-character-question"/);
    assert.doesNotMatch(markup, /你可以问他/);
    const overviewStart = markup.indexOf('data-testid="world-character-overview-section"');
    const milestonesStart = markup.indexOf('data-testid="world-character-milestones-section"');
    const mediaStart = markup.indexOf('data-testid="world-character-media-section"');
    assert.ok(overviewStart !== -1, 'overview section should render');
    assert.ok(mediaStart !== -1, 'media content should render');
    assert.ok(
      overviewStart < mediaStart && (milestonesStart === -1 || mediaStart < milestonesStart),
      'media content should be nested inside the overview section',
    );
  } finally {
    await changeLocale('en');
  }
});

test('world character career milestones read CBDB first and last year attributes', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    relationships: [
      {
        id: 'cbdb-rel-99984-office-1314-academy-1',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-office-academy',
        contentHash: 'rel-office-academy-hash',
        core: {
          presentation: {
            summary: '曾任书院山长，主持书院讲学。',
          },
          attributes: {
            firstYear: 1314,
            lastYear: 1316,
            officeLabel: '书院山长',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:99984:1314:1',
            joinStatus: 'resolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  const milestone = detail.worldCharacterAugmentation?.careerMilestones
    .find((item) => item.title === '书院山长');

  assert.equal(milestone?.kind, 'office');
  assert.equal(milestone?.timeLabel, '1314-1316');
  assert.equal(detail.characterProfile.milestones.some((item) => item.title === '书院山长'), false);
});

test('world character career milestones collapse authored career summaries with relationship office facts', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
          {
            id: 'yao-sui-career-chain',
            title: '历任翰林国史院直学士、学士、承旨',
            summary: '历任翰林国史院直学士、学士、承旨。',
            sequence: 1,
            timeLabel: null,
            kind: 'biography',
            derived: false,
          },
          {
            id: 'yao-sui-da-sinong',
            title: '官至大司农司司农丞',
            summary: '官至大司农司司农丞。',
            sequence: 2,
            timeLabel: null,
            kind: 'biography',
            derived: false,
          },
        ],
    },
    relationships: [
      {
        id: 'cbdb-rel-office-hanlin-xueshi',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-yao-sui',
        contentHash: 'rel-office-hanlin-xueshi-hash',
        core: {
          presentation: {
            summary: '姚燧曾任或关联官职：翰林国史院学士。',
          },
          attributes: {
            officeLabel: '翰林国史院学士',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:yao-sui:hanlin-xueshi:1',
          },
        },
      },
      {
        id: 'cbdb-rel-office-hanlin-zhi-xueshi',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-yao-sui',
        contentHash: 'rel-office-hanlin-zhi-xueshi-hash',
        core: {
          presentation: {
            summary: '姚燧曾任或关联官职：翰林国史院直学士。',
          },
          attributes: {
            officeLabel: '翰林国史院直学士',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:yao-sui:hanlin-zhi-xueshi:1',
          },
        },
      },
      {
        id: 'cbdb-rel-office-da-sinong',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-yao-sui',
        contentHash: 'rel-office-da-sinong-hash',
        core: {
          presentation: {
            summary: '姚燧曾任或关联官职：大司农司大司农丞。',
          },
          attributes: {
            officeLabel: '大司农司大司农丞',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:yao-sui:da-sinong:1',
          },
        },
      },
    ],
  }, 'source_materialization_available');
  const sharedMilestones = detail.characterProfile.milestones;
  const milestones = composeWorldCharacterMilestones(
    sharedMilestones,
    detail.worldCharacterAugmentation?.careerMilestones ?? [],
  );

  assert.equal(sharedMilestones.every((milestone) => milestone.kind === 'biography'), true);
  assert.equal(sharedMilestones.every((milestone) => !milestone.derived), true);
  assert.deepEqual(milestones.map((milestone) => milestone.title), [
    '历任翰林国史院直学士、学士、承旨',
    '官至大司农司司农丞',
  ]);
  assert.equal(milestones.every((milestone) => milestone.kind === 'office'), true);
  assert.equal(milestones.every((milestone) => milestone.derived), true);
  assert.match(milestones[0]?.summary ?? '', /历任翰林国史院直学士、学士、承旨/);
  assert.match(milestones[0]?.summary ?? '', /翰林国史院学士/);
  assert.match(milestones[0]?.summary ?? '', /翰林国史院直学士/);
  assert.match(milestones[1]?.summary ?? '', /官至大司农司司农丞/);
  assert.match(milestones[1]?.summary ?? '', /大司农司大司农丞/);
});

test('world character life milestones omit unknown time placeholder', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
          {
            id: 'untimed-biography-milestone',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 1,
            timeLabel: null,
            kind: 'biography',
            derived: false,
          },
        ],
    },
    relationships: [],
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

  assert.match(markup, /拜访故友/);
  assert.doesNotMatch(markup, /Time unknown|未标注/);
});

test('world character biographical timeline keeps untimed career clues in one reading flow', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
          {
            id: 'birth-1254',
            title: '1254年出生',
            summary: '1254年出生。',
            sequence: 1,
            timeLabel: '1254',
            kind: 'biography',
            derived: false,
          },
          {
            id: 'academy-1314',
            title: '1314年任书院山长',
            summary: '1314年任书院山长，主持书院讲学。',
            sequence: 2,
            timeLabel: '1314',
            kind: 'biography',
            derived: false,
          },
          {
            id: 'death-1331',
            title: '1331年去世',
            summary: '1331年去世。',
            sequence: 3,
            timeLabel: '1331',
            kind: 'biography',
            derived: false,
          },
          {
            id: 'untimed-biography-clue',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 4,
            timeLabel: null,
            kind: 'biography',
            derived: false,
          },
        ],
    },
    relationships: [
      {
        id: 'career-entry-untimed',
        type: 'entry',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-entry-huibi',
        contentHash: 'entry-huibi-hash',
        core: {
          presentation: {
            summary: '同怨与入仕记录「徽辟」有关。',
          },
          attributes: {
            entryLabel: '徽辟',
            rowRef: 'cbdb:ENTRY_DATA:99984:1',
          },
        },
      },
      {
        id: 'career-office-untimed',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-office-taizi',
        contentHash: 'office-taizi-hash',
        core: {
          presentation: {
            summary: '同怨曾任太子左赞善一职。',
          },
          attributes: {
            officeLabel: '太子左赞善',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:99984:2',
          },
        },
      },
    ],
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
  const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');

  assert.match(markup, /data-testid="world-character-biography-primary-node"/);
  assert.match(markup, /data-testid="world-character-biography-secondary-clue"/);
  assert.match(markup, /data-testid="world-character-biography-unmatched-clues"/);
  assert.match(markup, /1314年任书院山长/);
  assert.match(markup, /徽辟/);
  assert.match(markup, /太子左赞善/);
  assert.match(markup, /Undated clues/);
  assert.match(markup, /拜访故友/);
  assert.doesNotMatch(visibleMarkup, />1<\/span>/u);
  assert.doesNotMatch(visibleMarkup, />2<\/span>/u);
  assert.doesNotMatch(visibleMarkup, />3<\/span>/u);
  assert.doesNotMatch(visibleMarkup, /未知时间|未标注/);
});

test('world character biographical timeline without timed events renders one clues list', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
          {
            id: 'untimed-biography',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 1,
            timeLabel: null,
            kind: 'biography',
            derived: false,
          },
        ],
    },
    relationships: [
      {
        id: 'career-office-untimed-only',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-office-hanlin',
        contentHash: 'office-hanlin-hash',
        core: {
          presentation: {
            summary: '曾任翰林学士。',
          },
          attributes: {
            officeLabel: '翰林学士',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:99984:4',
          },
        },
      },
    ],
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

  assert.match(markup, /data-testid="world-character-biography-clue-list"/);
  assert.match(markup, /Biography clues/);
  assert.match(markup, /拜访故友/);
  assert.match(markup, /翰林学士/);
  assert.doesNotMatch(markup, /data-testid="world-character-biography-primary-node"/);
});
