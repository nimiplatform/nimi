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

test('resolved text endpoints become compact related titles without claiming authorship or parsing prose', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '唐龙',
      characterProfile: { ...ouYangDeRaw.characterProfile, milestones: [] },
      relationshipTargets: {
        memorials: { kind: 'text', name: '督府奏議(唐龍)' },
        learning: { kind: 'text', name: '易經大旨:四卷' },
        editor: { kind: 'person', name: '某编者' },
      },
      relationships: [
        { id: 'book-1', type: 'text', targetEntityId: 'memorials', summary: '唐龙与著作「督府奏議(唐龍)」有关。' },
        { id: 'book-2', type: 'text', targetEntityId: 'learning', summary: '唐龙与著作「易經大旨:四卷」有关。' },
        { id: 'letter', type: 'text', targetEntityId: 'editor', summary: '曾为友人文集作序。' },
        { id: 'unknown-book', type: 'text', targetEntityId: 'unresolved', summary: '与著作「无题稿」有关，书名尚待考。' },
      ],
    }, 'source_materialization_available');
    assert.deepEqual(source.works.filter(work => !work.textClue).map(work => work.title), ['督府奏議(唐龍)', '易經大旨:四卷']);
    assert.equal(source.works.filter(work => work.textClue).length, 2);
    const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
      source, stats: null, loading: false, error: false,
      onBack: () => {}, onOpenWorld: () => {}, onPrimaryAction: () => {},
    }));
    const worksMarkup = markup.slice(markup.indexOf('data-testid="world-character-works-section"'));
    assert.match(worksMarkup, /相关书目/);
    assert.match(worksMarkup, /督府奏议\(唐龙\)/);
    assert.match(worksMarkup, /易经大旨:四卷/);
    assert.match(worksMarkup, /书名尚待考/);
    assert.doesNotMatch(worksMarkup, /唐龙与著作|唐龙著有|data-testid="world-character-works-grid"/);
  } finally {
    await changeLocale('en');
  }
});

test('work introductions keep meaningful qualifications even when they begin with relation-only wording', () => {
  const summary = '欧阳德与著作「南野集」有关。现存版本的编者尚待确认。';
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: { ...ouYangDeRaw.characterProfile, milestones: [] },
    relationshipTargets: { book: { kind: 'text', name: '南野集' } },
    relationships: [{ id: 'book', type: 'text', targetEntityId: 'book', summary }],
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
    source, stats: null, loading: false, error: false,
    onBack: () => {}, onOpenWorld: () => {}, onPrimaryAction: () => {},
  }));
  assert.match(markup, /data-testid="world-character-works-grid"/);
  assert.ok(markup.includes(summary));
});

test('missing book endpoints keep reference semantics while repeated source-only sentences become a compact bibliography', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      displayName: '唐龙',
      characterProfile: { ...ouYangDeRaw.characterProfile, milestones: [] },
      relationships: [
        { id: 'a', type: 'text', summary: '唐龙与著作「二忠錄:二卷」有关。', attributes: { role: '0' } },
        { id: 'b', type: 'text', summary: '唐龙与著作「歷官奏議」有关。', attributes: { role: '1' } },
        { id: 'uncertain', type: 'text', summary: '唐龙与著作「无题稿」有关。作者尚待确认。' },
      ],
    }, 'source_materialization_available');
    assert.ok(source.works.every(work => work.textClue));
    const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
      source, stats: null, loading: false, error: false,
      onBack: () => {}, onOpenWorld: () => {}, onPrimaryAction: () => {},
    }));
    const bibliography = markup.slice(markup.indexOf('data-testid="world-character-bibliography"'), markup.indexOf('data-testid="world-character-text-clues"'));
    assert.match(bibliography, /二忠录:二卷/);
    assert.match(bibliography, /历官奏议/);
    assert.doesNotMatch(bibliography, /唐龙与著作|>0<|>1<|无题稿/);
    assert.ok(markup.includes('唐龙与著作「无题稿」有关。作者尚待确认。'));
  } finally {
    await changeLocale('en');
  }
});

test('work display follows the Simplified Chinese locale across titles, references and prose without mutating source records', async () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    displayName: '唐龙',
    characterProfile: { ...ouYangDeRaw.characterProfile, milestones: [] },
    relationshipTargets: { book: { kind: 'text', name: '漁石集:四卷' } },
    relationships: [
      { id: 'book', type: 'text', targetEntityId: 'book', summary: '收錄詩文，附有歷年著述。', attributes: { timeLabel: '嘉靖年間', romanizedTitle: 'Yushi ji' } },
      { id: 'reference', type: 'text', summary: '唐龙与著作「康山羣忠錄」有关。' },
      { id: 'clue', type: 'text', summary: '曾參與編輯，篇目尚待確認。' },
    ],
  }, 'source_materialization_available');
  const original = JSON.stringify(source);
  const renderWorks = () => {
    const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
      source, stats: null, loading: false, error: false,
      onBack: () => {}, onOpenWorld: () => {}, onPrimaryAction: () => {},
    }));
    return markup.slice(markup.indexOf('data-testid="world-character-works-section"'));
  };
  try {
    await changeLocale('zh');
    const zh = renderWorks();
    for (const text of ['渔石集:四卷', '收录诗文，附有历年著述。', '嘉靖年间', '康山群忠录', '曾参与编辑，篇目尚待确认。', 'Yushi ji']) {
      assert.ok(zh.includes(text), text);
    }
    assert.doesNotMatch(zh, /[漁錄詩歷間羣參與輯認]/);
    await changeLocale('en');
    const en = renderWorks();
    for (const text of ['漁石集:四卷', '收錄詩文，附有歷年著述。', '嘉靖年間', '康山羣忠錄', '曾參與編輯，篇目尚待確認。']) {
      assert.ok(en.includes(text), text);
    }
    assert.equal(JSON.stringify(source), original);
  } finally {
    await changeLocale('en');
  }
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
  const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
    source: detail, stats: null, loading: false, error: false,
    onBack: () => {}, onOpenWorld: () => {}, onPrimaryAction: () => {},
  }));
  assert.doesNotMatch(markup, /world-character-works-section/);
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

test('world character works keep office rows out while repeated text rows merge', () => {
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

  // Office rows stay out of works; repeated text rows merge into one work.
  assert.deepEqual(detail.characterProfile.milestones, []);
  assert.deepEqual(detail.works.map((work) => work.title), ['牧庵集']);
  assert.equal(detail.works[0]?.textId, 'muan');
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

test('same-title works with different text IDs stay separate even with a shared row reference', () => {
  const title = 'Collected Poems';
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      milestones: [{
        id: 'unidentified-work',
        title,
        summary: 'The source does not name an edition.',
        sequence: 1,
        timeLabel: null,
        kind: 'work',
        derived: false,
      }],
    },
    relationships: [
      { id: 'first', type: 'text', attributes: { textId: 'edition-a', title, rowRef: 'shared' } },
      { id: 'second', type: 'text', attributes: { textId: 'edition-b', title, rowRef: 'shared' } },
      {
        id: 'second-alias',
        type: 'text',
        summary: 'The second edition has a surviving preface.',
        attributes: { textId: 'edition-b', title: 'Selected Poems', joinStatus: 'resolved' },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map(({ textId, summary, status }) => ({ textId, summary, status })), [
    { textId: null, summary: 'The source does not name an edition.', status: 'unknown' },
    { textId: 'edition-a', summary: null, status: 'unknown' },
    { textId: 'edition-b', summary: 'The second edition has a surviving preface.', status: 'resolved' },
  ]);
});

test('an explicit text ID match takes precedence over an earlier title match', () => {
  const detail = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: { ...ouYangDeRaw.characterProfile, milestones: [] },
    relationships: [
      { id: 'unidentified', type: 'text', attributes: { title: 'Selected Poems' } },
      { id: 'identified', type: 'text', attributes: { textId: 'edition-a', title: 'Collected Poems' } },
      {
        id: 'alias',
        type: 'text',
        summary: 'The identified work has a surviving preface.',
        attributes: { textId: 'edition-a', title: 'Selected Poems' },
      },
    ],
  }, 'source_materialization_available');

  assert.deepEqual(detail.works.map(({ textId, summary }) => ({ textId, summary })), [
    { textId: null, summary: null },
    { textId: 'edition-a', summary: 'The identified work has a surviving preface.' },
  ]);
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

test('the shared detail renders dated and undated life events in source order and keeps works separate', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    bio: null,
    entity: null,
    relationships: [],
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      narrativeSummary: null,
      knowledgeTopics: [],
      knowledgeConstraints: [],
      interaction: null,
      milestones: [
        {
          id: 'undated-journey', title: 'Studied with local scholars', summary: 'Studied with local scholars',
          sequence: 1, timeLabel: null, kind: 'biography', derived: false,
        },
        {
          id: 'dated-office', title: 'Led the academy', summary: 'Taught a new generation of scholars.',
          sequence: 2, timeLabel: '1314–1316', kind: 'office', derived: false,
        },
        {
          id: 'work', title: 'Collected Lectures', summary: null,
          sequence: 3, timeLabel: null, kind: 'work', derived: false,
        },
      ],
    },
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
    source, loading: false, error: false, onOpenWorld() {}, onPrimaryAction() {},
  }));

  const events = markup.match(/<section data-testid="character-life-events"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(events);
  assert.match(events, /Studied with local scholars[\s\S]*1314–1316[\s\S]*Led the academy[\s\S]*Taught a new generation of scholars\./);
  assert.equal(events.match(/Studied with local scholars/g)?.length, 1);
  assert.doesNotMatch(events, /Collected Lectures/);
  assert.match(markup, /data-testid="world-character-works-section"[\s\S]*Collected Lectures/);
});

test('a profile with only work milestones has no life events section', () => {
  const source = toSourceDetailData(liBaiRaw, 'source_materialization_available');
  const markup = renderToStaticMarkup(React.createElement(SourceDetailView, {
    source, loading: false, error: false, onOpenWorld() {}, onPrimaryAction() {},
  }));

  assert.doesNotMatch(markup, /data-testid="character-life-events"/);
  assert.match(markup, /data-testid="world-character-works-section"/);
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
