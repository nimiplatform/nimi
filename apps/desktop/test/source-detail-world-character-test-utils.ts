import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

(globalThis as { React?: typeof React }).React = React;

export { changeLocale, initI18n } from '../src/shell/renderer/i18n';
export { SourceDetailView } from '../src/shell/renderer/features/source-detail/source-detail-view';
export { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model';
export { simplifySourceDetailChineseText } from '../src/shell/renderer/features/source-detail/source-detail-simplified-chinese';
export { React };

const TEST_BINDINGS = {
  app: {
    projection: {
      resourceBaseUrl: () => '',
    },
  },
} as DesktopCanonicalRendererBindings;

export function renderToStaticMarkup(element: React.ReactNode): string {
  return renderMarkup(
    React.createElement(DesktopRendererBindingProvider, { bindings: TEST_BINDINGS }, element),
  );
}

export const liBaiRaw = {
  id: 'cbdb-person-32540',
  displayName: '李白',
  handle: 'li-bai',
  avatarUrl: null,
  bio: '盛唐诗人。',
  createdAt: '2026-06-20T17:59:55.000Z',
  worldId: 'cbdb-tang-literati-world',
  sourceKind: 'worldCharacter',
  sourceId: 'cbdb-person-32540',
  sourceHash: 'a'.repeat(64),
  sourceRef: {
    kind: 'worldCharacter',
    id: 'cbdb-person-32540',
    worldId: 'cbdb-tang-literati-world',
    worldEntityRef: { kind: 'worldEntity', worldId: 'cbdb-tang-literati-world', entityId: 'cbdb-person-32540' },
    sourceHash: 'a'.repeat(64),
  },
  viewerRelation: {
    state: 'connectable',
    connectionId: null,
    runtimeSourceRef: null,
  },
  characterProfile: {
    role: '盛唐诗人',
    archetype: '诗人',
    traits: ['豪放'],
    knowledgeTopics: ['唐诗'],
    knowledgeConstraints: [],
    interactionModes: ['诗文问答'],
    milestones: [
      {
        id: 'text-25641',
        title: '李太白集',
        summary: null,
        sequence: 1,
        timeLabel: null,
        kind: 'work',
        derived: false,
      },
      {
        id: 'text-26414',
        title: '草堂集(李白)',
        summary: null,
        sequence: 2,
        timeLabel: null,
        kind: 'work',
        derived: false,
      },
    ],
    relationshipNotes: [],
    conversationAnchors: ['唐诗'],
    interaction: null,
  },
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

export const ouYangDeRaw = {
  id: 'cbdb-world-character-cbdb-ming-lettered-networks-world-cbdb-person-99984',
  displayName: '欧阳德',
  handle: 'ou-yang-de',
  avatarUrl: null,
  bio: '明代阳明学派重要学者与政治家。',
  createdAt: '2026-06-20T17:59:55.000Z',
  worldId: 'cbdb-ming-lettered-networks-world',
  sourceKind: 'worldCharacter',
  sourceId: 'cbdb-world-character-cbdb-ming-lettered-networks-world-cbdb-person-99984',
  sourceHash: 'b'.repeat(64),
  sourceRef: {
    kind: 'worldCharacter',
    id: 'cbdb-world-character-cbdb-ming-lettered-networks-world-cbdb-person-99984',
    worldId: 'cbdb-ming-lettered-networks-world',
    worldEntityRef: { kind: 'worldEntity', worldId: 'cbdb-ming-lettered-networks-world', entityId: 'cbdb-person-99984' },
    sourceHash: 'b'.repeat(64),
  },
  viewerRelation: {
    state: 'connectable',
    connectionId: null,
    runtimeSourceRef: null,
  },
  entity: {
    id: 'cbdb-person-99984',
    kind: 'person',
    name: '欧阳德',
    summary: '欧阳德，字崇一，号南野，谥文庄，江西泰和人。',
    contentHash: 'entity-hash-ou-yang-de',
    tags: ['世界实体', '人物'],
    facts: [],
  },
  characterProfile: {
    role: '阳明学派思想家与朝廷重臣',
    archetype: '阳明学派',
    traits: ['礼部尚书'],
    knowledgeTopics: ['阳明学派思想家与朝廷重臣'],
    knowledgeConstraints: ['身处嘉靖朝政治漩涡'],
    interactionModes: ['文人交游', '仕途回顾', '亲缘关系'],
    milestones: [
      {
        id: 'cbdb-person-99984-milestone-1',
        title: '嘉靖二年（1523）中进士',
        summary: '嘉靖二年（1523）中进士',
        sequence: 1,
        timeLabel: '1523',
        kind: 'biography',
        derived: false,
      },
      {
        id: 'cbdb-person-99984-milestone-3',
        title: '官至礼部尚书',
        summary: '官至礼部尚书',
        sequence: 3,
        timeLabel: '1554',
        kind: 'biography',
        derived: false,
      },
    ],
    relationshipNotes: [
      {
        id: 'cbdb-status-181',
        type: 'status',
        targetRef: 'cbdb-status-181',
        summary: '欧阳德被明确标识为阳明学派理学家，这是其最核心的学术身份。',
      },
      {
        id: 'cbdb-office-70625',
        type: 'postedToOffice',
        targetRef: 'cbdb-office-70625',
        summary: '官至礼部尚书，是其仕途的顶峰，掌管国家礼仪与科举事务。',
      },
    ],
    conversationAnchors: [
      '欧阳德会先请你说明想问诗文、仕途还是人生起落。',
      '阳明学派思想家与朝廷重臣',
      '身处嘉靖朝政治漩涡',
    ],
    interaction: {
      tone: '沉稳庄重，带有学者与高官的威严',
      cadence: '语速平缓，条理清晰，善用典故',
      scenario: '士人交游圈：以师友、同僚、门生关系为纽带。',
      greeting: '吾乃欧阳德，字崇一，号南野。',
    },
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
