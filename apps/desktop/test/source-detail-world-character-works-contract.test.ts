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
  simplifySourceDetailChineseText,
  toSourceDetailData,
} from './source-detail-world-character-test-utils.js';
import { composeWorldCharacterMilestones } from '../src/shell/renderer/features/source-detail/source-detail-world-character-milestones.js';

test.before(async () => {
  await initI18n();
});

test('world character source detail simplifier covers CBDB relationship prose from character dossier', () => {
  assert.equal(
    simplifySourceDetailChineseText('墓誌銘由劉智所作；墓表由毛憲所作；爲王璋所作詩文作序；其生祠由王道清作記；為吳善所著書作序；臨別得到李京所作贈言（送別詩、序）'),
    '墓志铭由刘智所作；墓表由毛宪所作；为王璋所作诗文作序；其生祠由王道清作记；为吴善所著书作序；临别得到李京所作赠言（送别诗、序）',
  );
});

test('character source detail maps public biography work events as works collections', () => {
  const detail = toSourceDetailData(liBaiRaw, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'available');
  assert.deepEqual(detail.works.map((work) => work.title), ['李太白集', '草堂集(李白)']);
  assert.deepEqual(detail.works[0], {
    id: 'text-25641',
    title: '李太白集',
    romanizedTitle: null,
    textId: null,
    rowRef: null,
    role: null,
    status: 'unknown',
    summary: null,
    timeLabel: null,
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

test('world character source detail hides paused score controls', () => {
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
});

test('world character source detail reports works unavailable when public biography has no work events', () => {
  const detail = toSourceDetailData({
    ...liBaiRaw,
    characterProfile: {
      ...liBaiRaw.characterProfile,
      milestones: [],
    },
  }, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'unavailable');
  assert.deepEqual(detail.works, []);
});


test('world character source detail uses Realm relationship neighborhood for works and clues', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');

  assert.equal(detail.worksAvailability, 'available');
  assert.deepEqual(detail.works.map((work) => work.title), ['欧阳南野先生文集']);
  assert.equal(detail.works[0]?.textId, '28102');
  assert.deepEqual(detail.relationshipClues.map((clue) => clue.label), [
    '理学家 - 阳明学派',
  ]);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.title), [
    '嘉靖二年（1523）中进士',
    '官至礼部尚书',
  ]);
  assert.equal(detail.characterProfile.milestones.some((milestone) => milestone.kind === 'work'), false);
});

test('world character career milestones keep repeated office rows while work rows stay in works', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [],
    },
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
  const sharedMilestones = detail.characterProfile.milestones;
  const milestones = composeWorldCharacterMilestones(
    sharedMilestones,
    detail.worldCharacterAugmentation?.careerMilestones ?? [],
  );
  const officeMilestones = milestones.filter((milestone) => milestone.kind === 'office' && milestone.title === '翰林学士');
  const workMilestones = milestones.filter((milestone) => milestone.kind === 'work' && milestone.title === '牧庵集');

  assert.deepEqual(sharedMilestones, []);
  assert.equal(officeMilestones.length, 1);
  assert.equal(workMilestones.length, 0);
  assert.match(officeMilestones[0]?.summary ?? '', /承担朝廷文字事务/);
  assert.match(officeMilestones[0]?.summary ?? '', /参与国史院修撰/);
  assert.deepEqual(detail.works.map((work) => work.title), ['牧庵集']);
  assert.equal(detail.works[0]?.textId, 'muan');
  assert.deepEqual(milestones.map((milestone) => milestone.title), ['翰林学士']);
});

test('world character works prefer graph detail when public biography and relationship evidence overlap', () => {
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
      status: 'unresolved',
    },
  ]);
});

test('world character works ignore non-public source rows and use relationship evidence', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    source: {
      ...ouYangDeRaw.source,
      authoring: {
        extensions: {
          sourcePerson: {
            texts: [
              {
                textId: 'source-muan',
                titleChn: '牧庵集',
                title: 'mu an ji',
                rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:source',
                joinStatus: 'resolved',
              },
            ],
          },
        },
      },
      biography: {
        milestones: [],
      },
      relationships: [],
    },
    relationships: [
      {
        id: 'cbdb-rel-text-muan-conflicting-id',
        type: 'text',
        sourceEntityId: 'cbdb-person-yao-sui',
        targetEntityId: 'cbdb-text-relationship-muan',
        contentHash: 'rel-text-muan-conflicting-id-hash',
        core: {
          presentation: {
            summary: '《牧庵集》是其文学成就的结晶，奠定了他在元代文坛的领袖地位。',
          },
          attributes: {
            textCode: 'relationship-muan',
            titleChn: '牧庵集',
            rowRef: 'cbdb:BIOG_TEXT_DATA:yao-sui:muan:relationship',
            joinStatus: 'unresolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => ({
    title: work.title,
    romanizedTitle: work.romanizedTitle,
    textId: work.textId,
    summary: work.summary ?? null,
    status: work.status,
  })), [
    {
      title: '牧庵集',
      romanizedTitle: null,
      textId: 'relationship-muan',
      summary: '《牧庵集》是其文学成就的结晶，奠定了他在元代文坛的领袖地位。',
      status: 'unresolved',
    },
  ]);
});

test('world character works do not consume legacy source text or biography shapes', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '同憕',
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [],
    },
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

  assert.deepEqual(detail.works, []);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.title), []);
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

test('world character works do not treat shared profile relationship notes as graph works', async () => {
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

    assert.doesNotMatch(markup, /牧庵集/);
    assert.doesNotMatch(markup, /姚燧与著作/);
  } finally {
    await changeLocale('en');
  }
});

test('shared public biography work events feed the works collection', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
        {
          id: 'cbdb-text-xueneng-poems',
          title: '薛能诗集',
          summary: '《薛能诗集》是其诗歌创作的重要结集，是其文学成就的直接体现。',
          sequence: 1,
          timeLabel: null,
          kind: 'work',
          derived: false,
        },
        {
          id: 'cbdb-text-fancheng',
          title: '繁城集',
          summary: '薛能与著作「繁城集」有关。',
          sequence: 2,
          timeLabel: null,
          kind: 'work',
          derived: false,
        },
      ],
    },
    relationships: [],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => work.title), ['薛能诗集', '繁城集']);
  assert.match(detail.works[0]?.summary ?? '', /文学成就/);
  assert.equal(detail.characterProfile.milestones.every((milestone) => milestone.kind === 'work'), true);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.title), ['薛能诗集', '繁城集']);
});

test('public biography explicitly distinguishes work and office milestones', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [
          {
            id: 'xueneng-poems',
            title: '薛能诗集',
            summary: '《薛能诗集》是其诗歌创作的重要结集，是其文学成就的直接体现。',
            sequence: 1,
            timeLabel: null,
            kind: 'work',
            derived: false,
          },
          {
            id: 'xueneng-office',
            title: '咸通年间任同州刺史',
            summary: '咸通年间任同州刺史。',
            sequence: 2,
            timeLabel: '咸通',
            kind: 'office',
            derived: false,
          },
        ],
    },
    relationships: [],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map((work) => work.title), ['薛能诗集']);
  assert.match(detail.works[0]?.summary ?? '', /诗歌创作/);
  assert.deepEqual(detail.characterProfile.milestones.map((milestone) => milestone.title), [
    '薛能诗集',
    '咸通年间任同州刺史',
  ]);
});

test('world character works keep label-only text relationships as text clues instead of works', () => {
  const detail = toSourceDetailData({
    ...liBaiRaw,
    relationships: [
      {
        id: 'cbdb-rel-text-exchange-1',
        type: 'text',
        sourceEntityId: 'cbdb-person-zhu-kejiu',
        contentHash: 'rel-text-exchange-1-hash',
        core: {
          presentation: {
            summary: '朱可久曾向白居易赠送诗文，与这位文坛巨擘有文学往来。',
          },
          attributes: {
            sourceRelationLabelChn: '著述线索',
            rowRef: 'cbdb:TEXT_REL:zhu-kejiu:exchange:1',
            joinStatus: 'resolved',
          },
        },
      },
      {
        id: 'cbdb-rel-text-exchange-2',
        type: 'text',
        sourceEntityId: 'cbdb-person-zhu-kejiu',
        contentHash: 'rel-text-exchange-2-hash',
        core: {
          presentation: {
            summary: '朱可久与元稹唱和颇多，诗名渐起于士大夫之间。',
          },
          attributes: {
            sourceRelationLabelChn: '著述线索',
            rowRef: 'cbdb:TEXT_REL:zhu-kejiu:exchange:2',
            joinStatus: 'resolved',
          },
        },
      },
      {
        id: 'cbdb-rel-text-exchange-3',
        type: 'text',
        sourceEntityId: 'cbdb-person-zhu-kejiu',
        contentHash: 'rel-text-exchange-3-hash',
        core: {
          presentation: {},
          attributes: {
            sourceRelationLabelChn: '著述线索',
            rowRef: 'cbdb:TEXT_REL:zhu-kejiu:exchange:3',
            joinStatus: 'resolved',
          },
        },
      },
    ],
  }, 'source_materialization_available');

  // Real works keep their titles; label-only rows stay as distinct text clues
  // (no title-based merge) and rows without any evidence prose are dropped.
  assert.deepEqual(detail.works.map((work) => work.title), ['李太白集', '草堂集(李白)', '著述线索', '著述线索']);
  assert.deepEqual(detail.works.map((work) => work.textClue === true), [false, false, true, true]);
  assert.deepEqual(detail.works.slice(2).map((work) => work.summary), [
    '朱可久曾向白居易赠送诗文，与这位文坛巨擘有文学往来。',
    '朱可久与元稹唱和颇多，诗名渐起于士大夫之间。',
  ]);
});

test('world character works render text clues apart from work cards and exclude them from the count', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...liBaiRaw,
      relationships: [
        {
          id: 'cbdb-rel-text-exchange-1',
          type: 'text',
          sourceEntityId: 'cbdb-person-zhu-kejiu',
          contentHash: 'rel-text-exchange-1-hash',
          core: {
            presentation: {
              summary: '朱可久曾向白居易赠送诗文，与这位文坛巨擘有文学往来。',
            },
            attributes: {
              sourceRelationLabelChn: '著述线索',
              rowRef: 'cbdb:TEXT_REL:zhu-kejiu:exchange:1',
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

    assert.match(markup, /收录 2 部相关作品/);
    assert.match(markup, /data-testid="world-character-text-clues"/);
    assert.match(markup, /朱可久曾向白居易赠送诗文/);
    assert.doesNotMatch(markup, /收录 3 部相关作品/);
  } finally {
    await changeLocale('en');
  }
});
