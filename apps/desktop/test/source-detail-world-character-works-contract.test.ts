import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view';
import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model';
import { simplifySourceDetailChineseText } from '../src/shell/renderer/features/source-detail/source-detail-simplified-chinese';

const liBaiRaw = {
  id: 'cbdb-person-32540',
  displayName: '李白',
  handle: 'li-bai',
  avatarUrl: null,
  bio: '盛唐诗人。',
  createdAt: '2026-06-20T17:59:55.000Z',
  worldId: 'cbdb-tang-literati-world',
  sourceKind: 'worldCharacter',
  sourceId: 'cbdb-person-32540',
  sourceContentHash: 'hash-li-bai',
  source: {
    state: 'source_materialization_available',
    authoring: {
      extensions: {
        sourcePerson: {
          texts: [
            {
              textId: 25641,
              rowRef: 'cbdb:BIOG_TEXT_DATA:32540:13008:1',
              titleChn: '李太白集',
              title: 'li tai bai ji',
              joinStatus: 'resolved',
            },
            {
              textId: 26414,
              rowRef: 'cbdb:BIOG_TEXT_DATA:32540:13009:2',
              titleChn: '草堂集(李白)',
              title: 'cao tang ji  (Li Bai)',
              joinStatus: 'resolved',
            },
          ],
        },
      },
    },
  },
};

test.before(async () => {
  await initI18n();
});

test('world character source detail simplifier covers CBDB relationship prose from character dossier', () => {
  assert.equal(
    simplifySourceDetailChineseText('墓誌銘由劉智所作；墓表由毛憲所作；爲王璋所作詩文作序；其生祠由王道清作記；為吳善所著書作序；臨別得到李京所作贈言（送別詩、序）'),
    '墓志铭由刘智所作；墓表由毛宪所作；为王璋所作诗文作序；其生祠由王道清作记；为吴善所著书作序；临别得到李京所作赠言（送别诗、序）',
  );
});

test('world character source detail maps source text rows as works collections only', () => {
  const detail = toSourceDetailData(liBaiRaw, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'available');
  assert.deepEqual(detail.works.map((work) => work.title), ['李太白集', '草堂集(李白)']);
  assert.deepEqual(detail.works[0], {
    id: 'text-25641',
    title: '李太白集',
    romanizedTitle: 'li tai bai ji',
    textId: '25641',
    rowRef: 'cbdb:BIOG_TEXT_DATA:32540:13008:1',
    role: null,
    status: 'resolved',
  });
  assert.equal(detail.works.some((work) => work.title === '将进酒'), false);
});

test('source detail renders works collections without inventing individual poems or exposing technical source fields', () => {
  const source = toSourceDetailData(liBaiRaw, 'source_materialization_available');
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

  assert.match(markup, /Works/);
  assert.match(markup, /李太白集/);
  assert.match(markup, /草堂集\(李白\)/);
  assert.doesNotMatch(visibleMarkup, /将进酒/);
  assert.doesNotMatch(visibleMarkup, /静夜思/);
  assert.doesNotMatch(visibleMarkup, /Source Kind/);
  assert.doesNotMatch(visibleMarkup, /World ID/);
  assert.doesNotMatch(visibleMarkup, /Source Ref/);
  assert.doesNotMatch(visibleMarkup, /Runtime Ref/);
  assert.doesNotMatch(visibleMarkup, /Text ID/);
  assert.doesNotMatch(visibleMarkup, /Row ref/);
  assert.doesNotMatch(visibleMarkup, /cbdb:BIOG_TEXT_DATA:32540:13008:1/);
  assert.doesNotMatch(visibleMarkup, /source_materialization_available/);
  assert.doesNotMatch(visibleMarkup, /worldCharacter/);
  assert.doesNotMatch(visibleMarkup, /Create local agent/);
  assert.doesNotMatch(visibleMarkup, /local agent/);
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

test('world character source detail hides paused score and gift controls', () => {
  const source = toSourceDetailData(liBaiRaw, 'source_materialization_available');
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

  assert.doesNotMatch(markup, />Score</);
  assert.doesNotMatch(markup, />Send Gift</);
});

test('world character source detail fails closed when source text rows are absent', () => {
  const detail = toSourceDetailData({
    ...liBaiRaw,
    source: {
      authoring: {
        extensions: {},
      },
    },
  }, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'unavailable');
  assert.deepEqual(detail.works, []);
});

const ouYangDeRaw = {
  id: 'cbdb-world-character-cbdb-ming-lettered-networks-world-cbdb-person-99984',
  displayName: '欧阳德',
  handle: 'ou-yang-de',
  avatarUrl: null,
  bio: '明代阳明学派重要学者与政治家。',
  createdAt: '2026-06-20T17:59:55.000Z',
  worldId: 'cbdb-ming-lettered-networks-world',
  sourceKind: 'worldCharacter',
  sourceId: 'cbdb-world-character-cbdb-ming-lettered-networks-world-cbdb-person-99984',
  sourceContentHash: 'hash-ou-yang-de',
  entity: {
    id: 'cbdb-person-99984',
    kind: 'person',
    name: '欧阳德',
    summary: '欧阳德，字崇一，号南野，谥文庄，江西泰和人。',
    contentHash: 'entity-hash-ou-yang-de',
    tags: ['世界实体', '人物'],
    facts: [],
  },
  source: {
    placement: {
      worldId: 'cbdb-ming-lettered-networks-world',
      entityId: 'cbdb-person-99984',
      role: '阳明学派思想家与朝廷重臣',
      faction: '阳明学派',
      rank: '礼部尚书',
      sceneRefs: ['ming-literati-network', 'ming-official-career', 'ming-kinship-clan'],
    },
    biography: {
      milestones: [
        {
          milestoneId: 'cbdb-person-99984-milestone-1',
          title: '嘉靖二年（1523）中进士',
          summary: '嘉靖二年（1523）中进士',
          sequence: 1,
          timeLabel: '1523',
        },
        {
          milestoneId: 'cbdb-person-99984-milestone-3',
          title: '官至礼部尚书',
          summary: '官至礼部尚书',
          sequence: 3,
          timeLabel: '1554',
        },
      ],
    },
    relationships: [
      {
        targetRef: 'cbdb-status-181',
        relationType: 'status',
        summary: '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。',
      },
      {
        targetRef: 'cbdb-office-70625',
        relationType: 'postedToOffice',
        summary: '官至礼部尚书，是其仕途的顶峰，掌管国家礼仪与科举事务。',
      },
    ],
    knowledge: {
      topics: ['阳明学派思想家与朝廷重臣'],
      constraints: ['身处嘉靖朝政治漩涡'],
    },
    interactionProfile: {
      tone: '沉稳庄重，带有学者与高官的威严',
      cadence: '语速平缓，条理清晰，善用典故',
      scenario: '士人交游圈：以师友、同僚、门生关系为纽带。',
      greeting: '吾乃欧阳德，字崇一，号南野。',
      greetingVariants: ['欧阳德会先请你说明想问诗文、仕途还是人生起落。'],
      dialogueExemplars: ['若问阳明学派思想家与朝廷重臣，我会先分清经历、心境与时代。'],
    },
  },
  relationships: [
    {
      id: 'cbdb-rel-99984-text-39371-28102-1',
      type: 'text',
      sourceEntityId: 'cbdb-person-99984',
      targetEntityId: 'cbdb-text-28102',
      contentHash: 'rel-text-hash',
      core: {
        presentation: {
          summary: '着有《欧阳南野先生文集》三十卷，是其思想与文学成就的主要载体。',
        },
        attributes: {
          year: 1545,
          textCode: '28102',
          titleChn: '欧阳南野先生文集',
          role: 'author',
          rowRef: 'cbdb:BIOG_TEXT_DATA:99984:39371:1',
          joinStatus: 'resolved',
        },
      },
    },
    {
      id: 'cbdb-rel-99984-office-219651-70625-9',
      type: 'postedToOffice',
      sourceEntityId: 'cbdb-person-99984',
      targetEntityId: 'cbdb-office-70625',
      contentHash: 'rel-office-hash',
      core: {
        presentation: {
          summary: '官至礼部尚书，是其仕途的顶峰，掌管国家礼仪与科举事务。',
        },
        attributes: {
          startYear: 1554,
          officeLabel: '礼部尚书',
          rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:99984:219651:9',
          joinStatus: 'resolved',
        },
      },
    },
    {
      id: 'cbdb-rel-99984-status-50507-181-1',
      type: 'status',
      sourceEntityId: 'cbdb-person-99984',
      targetEntityId: 'cbdb-status-181',
      contentHash: 'rel-status-hash',
      core: {
        presentation: {
          summary: '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。',
        },
        attributes: {
          statusLabel: '理学家 - 阳明学派',
          rowRef: 'cbdb:STATUS_DATA:99984:50507:1',
          joinStatus: 'resolved',
        },
      },
    },
  ],
};

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

test('world character source detail uses Realm relationship neighborhood for works and clues', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'available');
  assert.deepEqual(detail.works.map((work) => work.title), ['欧阳南野先生文集']);
  assert.equal(detail.works[0]?.textId, '28102');
  assert.deepEqual(detail.relationshipClues.map((clue) => clue.label), [
    '理学家 - 阳明学派',
  ]);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), [
    '嘉靖二年（1523）中进士',
    '官至礼部尚书',
  ]);
  assert.equal(detail.worldCharacter?.milestones.some((milestone) => milestone.kind === 'work'), false);
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

test('world character career milestones keep repeated office rows while work rows stay in works', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [],
      },
      relationships: [],
    },
    relationships: [
      {
        id: 'cbdb-rel-office-hanlin-1275-1',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-office-hanlin',
        contentHash: 'rel-office-hanlin-1275-1-hash',
        core: {
          presentation: {
            summary: '1275年姚燧入翰林学士院，承担朝廷文字事务。',
          },
          attributes: {
            year: 1275,
            officeLabel: '翰林学士',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:yao-sui:hanlin:1',
            joinStatus: 'resolved',
          },
        },
      },
      {
        id: 'cbdb-rel-office-hanlin-1275-2',
        type: 'postedToOffice',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-office-hanlin',
        contentHash: 'rel-office-hanlin-1275-2-hash',
        core: {
          presentation: {
            summary: '翰林学士任内参与国史院修撰，并与元代文人网络相连。',
          },
          attributes: {
            year: 1275,
            officeLabel: '翰林学士',
            rowRef: 'cbdb:POSTED_TO_OFFICE_DATA:yao-sui:hanlin:2',
            joinStatus: 'resolved',
          },
        },
      },
      {
        id: 'cbdb-rel-text-muan-1',
        type: 'text',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-text-muan',
        contentHash: 'rel-text-muan-1-hash',
        core: {
          presentation: {
            summary: '姚燧著有《牧庵集》，保存其文章与碑志。',
          },
          attributes: {
            year: 1301,
            textCode: 'muan',
            titleChn: '牧庵集',
            rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:1',
            joinStatus: 'resolved',
          },
        },
      },
      {
        id: 'cbdb-rel-text-muan-2',
        type: 'text',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-text-muan',
        contentHash: 'rel-text-muan-2-hash',
        core: {
          presentation: {
            summary: '《牧庵集》也是理解其文学地位的重要作品。',
          },
          attributes: {
            year: 1301,
            textCode: 'muan',
            titleChn: '牧庵文集',
            rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:2',
            joinStatus: 'resolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');
  const milestones = detail.worldCharacter?.milestones ?? [];
  const officeMilestones = milestones.filter((milestone) => milestone.kind === 'office' && milestone.title === '翰林学士');
  const workMilestones = milestones.filter((milestone) => milestone.kind === 'work' && milestone.title === '牧庵集');

  assert.equal(officeMilestones.length, 1);
  assert.equal(workMilestones.length, 0);
  assert.match(officeMilestones[0]?.summary ?? '', /承担朝廷文字事务/);
  assert.match(officeMilestones[0]?.summary ?? '', /参与国史院修撰/);
  assert.deepEqual(detail.works.map((work) => work.title), ['牧庵集']);
  assert.equal(detail.works[0]?.textId, 'muan');
  assert.deepEqual(milestones.map((milestone) => milestone.title), ['翰林学士']);
});

test('world character works collapse duplicated biography and relationship evidence into the best collection card', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'bio-muan-work',
            title: '著有《牧庵集》',
            summary: '著有《牧庵集》',
            rowRef: 'cbdb:BIOG_WORK:yao-sui:muan:bio',
            sequence: 1,
          },
        ],
      },
      relationships: [
        {
          relationType: 'text',
          summary: '姚燧与著作「牧菴集」有关。',
          attributes: {
            targetLabel: '牧菴集',
            rowRef: 'cbdb:TEXT_REL:yao-sui:muan:generic',
            joinStatus: 'resolved',
          },
        },
      ],
    },
    relationships: [
      {
        id: 'cbdb-rel-text-muan-best',
        type: 'text',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-text-muan-best',
        contentHash: 'rel-text-muan-best-hash',
        core: {
          presentation: {
            summary: '《牧庵集》是其文学成就的结晶，奠定了他在元代文坛的领袖地位。',
          },
          attributes: {
            titleChn: '牧庵集',
            rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:best',
            joinStatus: 'unresolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => ({
    title: work.title,
    summary: work.summary,
    status: work.status,
  })), [
    {
      title: '牧庵集',
      summary: '《牧庵集》是其文学成就的结晶，奠定了他在元代文坛的领袖地位。',
      status: 'resolved',
    },
  ]);
});

test('world character works collapse source text rows and generic biography text-code evidence', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '同憕',
    source: {
      ...ouYangDeRaw.source,
      authoring: {
        extensions: {
          sourcePerson: {
            texts: [
              {
                textId: 43210,
                titleChn: '庵集',
                title: 'an ji',
                rowRef: 'cbdb:BIOG_TEXT_DATA:tong-cheng:an-ji:1',
                joinStatus: 'resolved',
              },
            ],
          },
        },
      },
      biography: {
        milestones: [
          {
            milestoneId: 'bio-an-ji-work',
            title: '同憕著有《庵集》',
            summary: '同憕著有《庵集》。',
            textCode: 'an-ji',
            sequence: 1,
          },
        ],
      },
      relationships: [],
    },
    relationships: [],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => ({
    title: work.title,
    romanizedTitle: work.romanizedTitle,
    textId: work.textId,
    summary: work.summary ?? null,
    status: work.status,
  })), [
    {
      title: '庵集',
      romanizedTitle: 'an ji',
      textId: '43210',
      summary: null,
      status: 'resolved',
    },
  ]);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), []);
});

test('world character works hide ingestion status badges from profile cards', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      source: {
        ...ouYangDeRaw.source,
        biography: {
          milestones: [
            {
              milestoneId: 'bio-muan-work',
              title: '著有《牧庵集》',
              summary: '著有《牧庵集》',
              rowRef: 'cbdb:BIOG_WORK:yao-sui:muan:bio',
              sequence: 1,
            },
          ],
        },
        relationships: [
          {
            relationType: 'text',
            summary: '姚燧与著作「牧菴集」有关。',
            attributes: {
              targetLabel: '牧菴集',
              rowRef: 'cbdb:TEXT_REL:yao-sui:muan:generic',
              joinStatus: 'resolved',
            },
          },
        ],
      },
      relationships: [
        {
          id: 'cbdb-rel-text-muan-best',
          type: 'text',
          sourceEntityId: 'cbdb-person-yao-sui',
          targetEntityId: 'cbdb-text-muan-best',
          contentHash: 'rel-text-muan-best-hash',
          core: {
            presentation: {
              summary: '《牧庵集》是其文学成就的结晶，奠定了他在元代文坛的领袖地位。',
            },
            attributes: {
              titleChn: '牧庵集',
              rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:best',
              joinStatus: 'unresolved',
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

    assert.match(markup, /牧庵集/);
    assert.match(markup, /文学成就的结晶/);
    assert.doesNotMatch(markup, /姚燧与著作/);
    assert.doesNotMatch(markup, /待确认|已收录/);
  } finally {
    await changeLocale('en');
  }
});

test('world character works do not render generic relationship summaries as evidence copy', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      source: {
        ...ouYangDeRaw.source,
        biography: {
          milestones: [],
        },
        relationships: [
          {
            relationType: 'text',
            summary: '姚燧与著作「牧庵集」有关。',
            attributes: {
              targetLabel: '牧庵集',
              rowRef: 'cbdb:TEXT_REL:yao-sui:muan:generic',
              joinStatus: 'resolved',
            },
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

    assert.match(markup, /牧庵集/);
    assert.doesNotMatch(markup, /姚燧与著作/);
  } finally {
    await changeLocale('en');
  }
});

test('world character source relationships move text works into works instead of career milestones', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [],
      },
      relationships: [
        {
          targetRef: 'cbdb-text-xueneng-poems',
          targetLabel: '薛能诗集',
          relationType: 'text',
          relationLabel: '著作',
          summary: '《薛能诗集》是其诗歌创作的重要结集，是其文学成就的直接体现。',
        },
        {
          targetRef: 'cbdb-text-fancheng',
          relationType: 'text',
          relationLabel: '著作',
          summary: '薛能与著作「繁城集」有关。',
        },
      ],
    },
    relationships: [],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => work.title), ['薛能诗集', '繁城集']);
  assert.match(detail.works[0]?.summary ?? '', /文学成就/);
  assert.equal(detail.worldCharacter?.milestones.some((milestone) => milestone.kind === 'work'), false);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), []);
});

test('world character work-like biography milestones move into works instead of life milestones', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      biography: {
        milestones: [
          {
            milestoneId: 'xueneng-poems',
            title: '薛能诗集',
            summary: '《薛能诗集》是其诗歌创作的重要结集，是其文学成就的直接体现。',
            sequence: 1,
          },
          {
            milestoneId: 'xueneng-office',
            title: '咸通年间任同州刺史',
            summary: '咸通年间任同州刺史。',
            sequence: 2,
            timeLabel: '咸通',
          },
        ],
      },
      relationships: [],
    },
    relationships: [],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => work.title), ['薛能诗集']);
  assert.match(detail.works[0]?.summary ?? '', /诗歌创作/);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), [
    '咸通年间任同州刺史',
  ]);
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

test('world character relationship map keeps factual clue text out of graph nodes', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    relationships: [
      ...ouYangDeRaw.relationships,
      {
        id: 'cbdb-rel-99984-association-liu-zhi-1',
        type: 'association',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-person-liu-zhi',
        contentHash: 'rel-association-liu-zhi-hash',
        core: {
          presentation: {
            summary: '刘智与欧阳德存在交游或关联记录。',
          },
          attributes: {
            sourceRelationLabelChn: '墓誌銘由劉智所作',
            rowRef: 'cbdb:ASSOC_DATA:99984:liu-zhi:1',
            joinStatus: 'resolved',
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

  const associationClue = source.relationshipClues.find((clue) => clue.id === 'cbdb-rel-99984-association-liu-zhi-1');
  assert.equal(associationClue?.label, '墓志铭由刘智所作');

  const mapStart = markup.indexOf('data-testid="world-character-relationship-map"');
  const mapEnd = markup.indexOf('<div class="mt-4 flex flex-wrap gap-2">', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);

  assert.match(mapMarkup, /刘智/);
  assert.doesNotMatch(mapMarkup, /墓志铭由刘智所作/);
  assert.doesNotMatch(markup, /墓誌銘|劉智/);
  assert.doesNotMatch(mapMarkup, /truncate text-xs leading-4 opacity-75/);
  assert.match(markup, /<h3 class="text-sm font-semibold leading-6 text-\[#262017\]">墓志铭由刘智所作<\/h3>/);
});

test('world character relationship map renders posted address clues with location icons', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      relationships: [],
    },
    relationships: [
      {
        id: 'cbdb-rel-99984-posted-address-jingzhao-1',
        type: 'postedAddress',
        sourceEntityId: 'cbdb-person-99984',
        targetEntityId: 'cbdb-place-jingzhao',
        contentHash: 'rel-posted-address-jingzhao-hash',
        core: {
          presentation: {
            summary: '欧阳德任官或活动记录关联地点「京兆府」。',
          },
          attributes: {
            addressLabel: '京兆府',
            officeLabel: '翰林学士',
            firstYear: 1086,
            lastYear: null,
            rowRef: 'cbdb:POSTED_ADDRESS_DATA:99984:jingzhao:1',
            joinStatus: 'resolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(source.relationshipClues.map((clue) => [clue.type, clue.label]), [
    ['postedAddress', '京兆府'],
  ]);

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
  const mapStart = markup.indexOf('data-testid="world-character-relationship-map"');
  const mapEnd = markup.indexOf('<div class="mt-4 flex flex-wrap gap-2">', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);
  const cardStart = markup.indexOf('data-testid="world-character-relationship-clue-postedAddress"');
  const cardEnd = markup.indexOf('</article>', cardStart);
  const cardMarkup = markup.slice(cardStart, cardEnd);

  assert.match(mapMarkup, /京兆府/);
  assert.match(mapMarkup, /lucide-map-pin/);
  assert.doesNotMatch(mapMarkup, /lucide-user-round/);
  assert.match(cardMarkup, /lucide-map-pin/);
  assert.match(cardMarkup, /1086/);
  assert.match(cardMarkup, /翰林学士/);
  assert.match(cardMarkup, /京兆府/);
  assert.doesNotMatch(cardMarkup, /lucide-user-round/);
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

test('world character source detail renders circular banner-overlap avatar and simplified Chinese scene labels', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      placement: {
        ...ouYangDeRaw.source.placement,
        sceneRefs: ['yuan-literati-network', 'yuan-academy-gathering', 'yuan-official-court'],
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

  assert.match(markup, /data-testid="world-character-hero-avatar"[^>]*rounded-full/);
  assert.match(markup, /data-testid="world-character-hero-banner"/);
  assert.match(markup, /元代文人网络 \/ 元代书院雅集 \/ 元代朝廷官场/);
  assert.doesNotMatch(markup, /yuan-literati-network/);
  assert.doesNotMatch(markup, /yuan-academy-gathering/);
  assert.doesNotMatch(markup, /yuan-official-court/);
  assert.doesNotMatch(markup, /書|學|與|為|從|處|臺|傳/);
});

test('world character hero uses dynasty subtitle, no bottom white mask, and hides removed hero metadata copy', async () => {
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
      source: {
        ...ouYangDeRaw.source,
        placement: {
          ...ouYangDeRaw.source.placement,
          sceneRefs: ['yuan-literati-network'],
        },
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

    assert.match(markup, /元代/);
    assert.match(markup, /data-testid="world-character-hero-title-row"[^>]*class="[^"]*flex[^"]*items-baseline[^"]*gap-3/);
    assert.match(markup, /data-testid="world-character-hero-title-row"[\s\S]*同恕[\s\S]*元代/);
    assert.doesNotMatch(markup, /<p class="[^"]*">同恕<\/p>/);
    assert.doesNotMatch(markup, /linear-gradient\(to top, rgba\(255,255,255,0\.32\)/);
    assert.match(markup, /立即对话/);
    assert.match(markup, /加入我的角色/);
    assert.doesNotMatch(markup, /加入后可在本地持续对话/);
    assert.doesNotMatch(markup, /当前身份/);
    assert.doesNotMatch(markup, /身份标签/);
    assert.doesNotMatch(markup, /添加到我的角色/);
  } finally {
    await changeLocale('en');
  }
});

test('world character source detail renders admitted CBDB dossier prose in simplified Chinese', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '蘇軾',
    handle: 'su-shi',
    entity: {
      ...ouYangDeRaw.entity,
      name: '蘇軾',
      summary: '元代文學與關係網核心人物，後歷任翰林學士承旨，舊友往來甚廣。',
    },
    source: {
      ...ouYangDeRaw.source,
      placement: {
        ...ouYangDeRaw.source.placement,
        role: '文學領袖與朝廷重臣',
        faction: '元代文人關係網',
        rank: '翰林學士承旨',
      },
      biography: {
        milestones: [
          {
            milestoneId: 'cbdb-person-traditional-milestone-1',
            title: '後入翰林學士院',
            summary: '舊臣推舉入翰林學士院，聲名甚廣。',
            sequence: 1,
            timeLabel: '1275',
          },
        ],
      },
      knowledge: {
        topics: ['文學與關係網', '舊友往來甚廣'],
        constraints: ['語氣沉穩，少談臺閣舊事'],
      },
      interactionProfile: {
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

  assert.equal(source.displayName, '苏轼');
  assert.equal(source.entity?.summary, '元代文学与关系网核心人物，后历任翰林学士承旨，旧友往来甚广。');
  assert.equal(source.worldCharacter?.faction, '元代文人关系网');
  assert.equal(source.worldCharacter?.milestones[0]?.title, '后入翰林学士院');

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

  assert.match(visibleMarkup, /苏轼/);
  assert.match(visibleMarkup, /元代文学与关系网核心人物，后历任翰林学士承旨，旧友往来甚广。/);
  assert.match(visibleMarkup, /文学领袖与朝廷重臣/);
  assert.match(visibleMarkup, /元代文人关系网/);
  assert.match(visibleMarkup, /后入翰林学士院/);
  assert.match(visibleMarkup, /旧臣推举入翰林学士院，声名甚广。/);
  assert.match(visibleMarkup, /语速平缓，听感庄重/);
  assert.doesNotMatch(visibleMarkup, /蘇|軾|學|與|關|係|後|歷|舊|廣|領|聲|語|聽|莊|會/);
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

test('world character source detail renders dossier sections without exposing raw relationship source fields', () => {
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
  const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');

  assert.match(markup, /Identity coordinates/);
  assert.match(markup, /Life milestones/);
  assert.match(markup, /data-testid="world-character-milestones-timeline"/);
  assert.match(markup, /Relationship clues/);
  assert.match(markup, /阳明学派思想家与朝廷重臣/);
  assert.match(markup, /嘉靖二年（1523）中进士/);
  assert.match(markup, /1554/);
  assert.match(markup, /1545/);
  assert.match(markup, /欧阳南野先生文集/);
  assert.match(markup, /data-testid="world-character-relationship-map"/);
  assert.match(markup, /data-testid="world-character-career-derived-node"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-clue-postedToOffice"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-clue-text"/);
  assert.doesNotMatch(visibleMarkup, /cbdb-rel-99984/);
  assert.doesNotMatch(visibleMarkup, /cbdb:BIOG_TEXT_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:POSTED_TO_OFFICE_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:STATUS_DATA/);
  assert.doesNotMatch(visibleMarkup, /Friends/);
  assert.doesNotMatch(visibleMarkup, /Posts/);
  assert.doesNotMatch(visibleMarkup, /Likes/);
});
