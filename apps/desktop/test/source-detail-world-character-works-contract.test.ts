import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view';
import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model';

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
    state: 'source_materializable',
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

test('world character source detail maps source text rows as works collections only', () => {
  const detail = toSourceDetailData(liBaiRaw, 'source_materializable');

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
  const source = toSourceDetailData(liBaiRaw, 'source_materializable');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      worldScore: 0,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
      onSendGift: () => {},
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
  assert.doesNotMatch(visibleMarkup, /source_materializable/);
  assert.doesNotMatch(visibleMarkup, /worldCharacter/);
  assert.doesNotMatch(visibleMarkup, /Create local agent/);
  assert.doesNotMatch(visibleMarkup, /local agent/);
});

test('world character source detail uses the dedicated world character page surface', () => {
  const source = toSourceDetailData(liBaiRaw, 'source_materializable');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: { friendsCount: 2, postsCount: 3, likesCount: 5 },
      worldScore: 72,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
      onSendGift: () => {},
    }),
  );

  assert.match(markup, /data-testid="world-character-source-detail-page"/);
  assert.match(markup, /data-testid="world-character-works-section"/);
  assert.doesNotMatch(markup, /data-testid="world-character-source-boundary"/);
  assert.doesNotMatch(markup, /data-testid="source-detail-compact-profile-card"/);
});

test('world character source detail fails closed when source text rows are absent', () => {
  const detail = toSourceDetailData({
    ...liBaiRaw,
    source: {
      authoring: {
        extensions: {},
      },
    },
  }, 'source_materializable');

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
        },
        {
          milestoneId: 'cbdb-person-99984-milestone-3',
          title: '官至礼部尚书',
          summary: '官至礼部尚书',
          sequence: 3,
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
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materializable');

  assert.equal(detail.worldCharacter?.role, '阳明学派思想家与朝廷重臣');
  assert.equal(detail.worldCharacter?.faction, '阳明学派');
  assert.equal(detail.worldCharacter?.rank, '礼部尚书');
  assert.deepEqual(detail.worldCharacter?.sceneRefs, ['ming-literati-network', 'ming-official-career', 'ming-kinship-clan']);
  assert.deepEqual(detail.worldCharacter?.milestones.map((milestone) => milestone.title), [
    '嘉靖二年（1523）中进士',
    '官至礼部尚书',
  ]);
  assert.equal(detail.worldCharacter?.relationshipNotes[0]?.summary, '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。');
  assert.match(detail.worldCharacter?.conversationAnchors.join('\n') ?? '', /想问诗文、仕途还是人生起落/);
});

test('world character source detail uses Realm relationship neighborhood for works and clues', () => {
  const detail = toSourceDetailData(ouYangDeRaw, 'source_materializable');

  assert.equal(detail.worksAvailability, 'available');
  assert.deepEqual(detail.works.map((work) => work.title), ['欧阳南野先生文集']);
  assert.equal(detail.works[0]?.textId, '28102');
  assert.deepEqual(detail.relationshipClues.map((clue) => clue.label), [
    '礼部尚书',
    '理学家 - 阳明学派',
  ]);
});

test('world character source detail renders dossier sections without exposing raw relationship source fields', () => {
  const source = toSourceDetailData(ouYangDeRaw, 'source_materializable');
  const markup = renderToStaticMarkup(
    React.createElement(SourceDetailView, {
      source,
      stats: null,
      worldScore: 0,
      loading: false,
      error: false,
      onBack: () => {},
      onOpenWorld: () => {},
      onPrimaryAction: () => {},
      onSendGift: () => {},
    }),
  );
  const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');

  assert.match(markup, /Identity coordinates/);
  assert.match(markup, /Life milestones/);
  assert.match(markup, /Relationship clues/);
  assert.match(markup, /阳明学派思想家与朝廷重臣/);
  assert.match(markup, /嘉靖二年（1523）中进士/);
  assert.match(markup, /欧阳南野先生文集/);
  assert.doesNotMatch(visibleMarkup, /cbdb-rel-99984/);
  assert.doesNotMatch(visibleMarkup, /cbdb:BIOG_TEXT_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:POSTED_TO_OFFICE_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:STATUS_DATA/);
  assert.doesNotMatch(visibleMarkup, /Friends/);
  assert.doesNotMatch(visibleMarkup, /Posts/);
  assert.doesNotMatch(visibleMarkup, /Likes/);
});
