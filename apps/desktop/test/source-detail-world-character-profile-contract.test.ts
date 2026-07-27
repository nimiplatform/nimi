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

test('world character source detail uses the dedicated world character page surface', () => {
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

  assert.match(markup, /data-testid="world-character-source-detail-page"/);
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
    assert.match(markup, /形象与声音/);
    assert.doesNotMatch(markup, /人物档案/);
    assert.doesNotMatch(markup, /相关阅读/);
    assert.doesNotMatch(markup, /人物生平/);
    assert.doesNotMatch(markup, /图谱证据/);
    assert.doesNotMatch(markup, />形象<\/p>/);
  } finally {
    await changeLocale('en');
  }
});

test('world character source detail projects admitted character dossier fields', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');

  assert.equal(detail.worldCharacter?.role, '阳明学派思想家与朝廷重臣');
  assert.equal(detail.worldCharacter?.faction, '阳明学派');
  assert.equal(detail.worldCharacter?.rank, '礼部尚书');
  assert.deepEqual(detail.worldCharacter?.sceneRefs, ['ming-literati-network', 'ming-official-career', 'ming-kinship-clan']);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), [
    '嘉靖二年（1523）中进士',
    '官至礼部尚书',
  ]);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.timeLabel), [
    '1523',
    '1554',
  ]);
  assert.equal(detail.worldCharacter?.milestones[1]?.kind, 'office');
  assert.equal(detail.worldCharacter?.milestones[1]?.derived, true);
  assert.match(detail.worldCharacter?.milestones[1]?.summary ?? '', /掌管国家礼仪与科举事务/);
  assert.equal(detail.worldCharacter?.relationshipNotes[0]?.summary, '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。');
  assert.match(detail.worldCharacter?.conversationAnchors.join('\n') ?? '', /想问诗文、仕途还是人生起落/);
});

test('world character conversation rail renders direct questions instead of raw clue list', async () => {
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
    const askStart = markup.indexOf('data-testid="world-character-ask-section"');
    const askMarkup = markup.slice(askStart, markup.indexOf('</section>', askStart));

    assert.match(markup, /你可以问他/);
    assert.doesNotMatch(markup, /可聊线索/);
    assert.match(askMarkup, /<button[^>]*type="button"[^>]*data-testid="world-character-question"/);
    assert.doesNotMatch(askMarkup, /<p[^>]*data-testid="world-character-question"/);
    assert.doesNotMatch(markup, /你可以讲讲/);
    assert.doesNotMatch(markup, /欧阳德会先请你说明想问诗文、仕途还是人生起落/);
    assert.match(markup, /他为什么被称为阳明学派思想家与朝廷重臣？/);
    assert.match(markup, /阳明学派怎样影响了他的一生？/);
    assert.match(markup, /担任礼部尚书时，他经历了什么？/);
    assert.match(markup, /他在明代文人网络里经历了什么？/);
    assert.match(markup, /欧阳南野先生文集为什么重要？/);
  } finally {
    await changeLocale('en');
  }
});

test('world character conversation rail filters raw CBDB relationship templates from suggestions', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '同恕',
      entity: {
        ...ouYangDeRaw.entity,
        name: '同恕',
      },
      source: {
        ...ouYangDeRaw.source,
        placement: {
          ...ouYangDeRaw.source.placement,
          role: '思想家、书院山长',
          faction: '元代文人书院网络',
          rank: '书院山长、太子左赞善',
          sceneRefs: ['yuan-academy-gathering', 'yuan-official-court', 'yuan-literati-network'],
        },
      },
      relationships: [
        {
          id: 'raw-association-farewell',
          type: 'association',
          core: {
            attributes: {
              sourceRelationLabelChn: '临别得到Y所作赠言（送别诗、序）',
            },
          },
        },
        {
          id: 'raw-association-occasion',
          type: 'association',
          core: {
            attributes: {
              sourceRelationLabel: '从Y处收到贺词（occasion）',
            },
          },
        },
        {
          id: 'raw-association-image-record',
          type: 'association',
          core: {
            attributes: {
              sourceRelationLabelChn: '画赞（图像记）由Y所作',
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
    const askStart = markup.indexOf('data-testid="world-character-ask-section"');
    const askMarkup = markup.slice(askStart, markup.indexOf('</section>', askStart));

    assert.match(askMarkup, /他为什么被称为思想家、书院山长？/);
    assert.match(askMarkup, /元代文人书院网络怎样影响了他的一生？/);
    assert.match(askMarkup, /担任书院山长、太子左赞善时，他经历了什么？/);
    assert.match(askMarkup, /他在元代书院雅集里经历了什么？/);
    assert.doesNotMatch(askMarkup, /Y所作|occasion|图像记|送别诗、序|他和临别|他和从Y处|他和画赞/);
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

  const milestone = detail.worldCharacter?.milestones.find((item) => item.title === '书院山长');

  assert.equal(milestone?.kind, 'office');
  assert.equal(milestone?.timeLabel, '1314-1316');
});

test('world character career milestones collapse authored career summaries with relationship office facts', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'yao-sui-career-chain',
            title: '历任翰林国史院直学士、学士、承旨',
            summary: '历任翰林国史院直学士、学士、承旨。',
            sequence: 1,
          },
          {
            milestoneId: 'yao-sui-da-sinong',
            title: '官至大司农司司农丞',
            summary: '官至大司农司司农丞。',
            sequence: 2,
          },
        ],
      },
      relationships: [],
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
  const milestones = detail.worldCharacter?.milestones ?? [];

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
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'untimed-biography-milestone',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 1,
          },
        ],
      },
      relationships: [],
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
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'birth-1254',
            title: '1254年出生',
            summary: '1254年出生。',
            sequence: 1,
          },
          {
            milestoneId: 'academy-1314',
            title: '1314年任书院山长',
            summary: '1314年任书院山长，主持书院讲学。',
            sequence: 2,
          },
          {
            milestoneId: 'death-1331',
            title: '1331年去世',
            summary: '1331年去世。',
            sequence: 3,
          },
          {
            milestoneId: 'untimed-biography-clue',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 4,
          },
        ],
      },
      relationships: [],
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
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'untimed-biography',
            title: '拜访故友',
            summary: '与故友重逢。',
            sequence: 1,
          },
        ],
      },
      relationships: [],
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
