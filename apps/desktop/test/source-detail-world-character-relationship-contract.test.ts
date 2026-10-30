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
import { buildRelationshipClueItems, WorldCharacterRelationshipCluesSection, WorldCharacterBackgroundSections } from '../src/shell/renderer/features/source-detail/source-detail-world-character-relationship-clues.js';
import { i18n } from '../src/shell/renderer/i18n/index.js';
import type { SourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';

function AllRelationshipSections({ source }: { source: SourceDetailData }) {
  return React.createElement(React.Fragment, null,
    React.createElement(WorldCharacterRelationshipCluesSection, { source }),
    React.createElement(WorldCharacterBackgroundSections, { source }));
}

test.before(async () => {
  await initI18n();
});

test('only resolved person endpoints enter relationships; creative work and additional background are omitted', () => {
  const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
  source.relationshipClues = [];
  source.relationshipTargets = {
    friend: { kind: 'human', name: '友人' },
    spirit: { kind: 'river-spirit', name: '河灵', isCharacter: true },
    port: { kind: 'port-town', name: '苇岸港' },
    inn: { kind: 'organization', name: '饭馆' },
    plant: { kind: 'plant', name: '山茶' },
    painting: { kind: 'item', name: '墨轴' },
  };
  source.characterProfile = { ...source.characterProfile, relationshipNotes: [
    { id: 'friend', type: 'custom-bond', targetRef: 'friend', summary: '友人相助。' },
    { id: 'spirit', type: 'custom-bond', targetRef: 'spirit', summary: '河灵与他相识。' },
    { id: 'port', type: 'inhabits', targetRef: 'port', summary: '在港口生活。' },
    // A misleading relation name cannot turn an organization into a person.
    { id: 'inn', type: 'spouses', targetRef: 'inn', summary: '在饭馆工作。' },
    { id: 'plant', type: 'caretaker-of', targetRef: 'plant', summary: '照料盆景。' },
    { id: 'painting', type: 'creator-of', targetRef: 'painting', summary: '创作墨轴。' },
    { id: 'unknown', type: 'kinship', targetRef: 'unresolved', summary: '未能确认的关系。' },
  ] };
  for (const sourceRef of [source.sourceRef, {
    kind: 'personaCharacter' as const, id: 'persona', worldId: source.worldId,
    ownerAccountId: 'owner', sourceHash: 'f'.repeat(64),
  }]) {
    const input = { ...source, sourceRef, sourceKind: sourceRef.kind };
    const people = renderToStaticMarkup(React.createElement(WorldCharacterRelationshipCluesSection, { source: input }));
    assert.match(people, /友人相助。/);
    assert.match(people, /河灵与他相识。/);
    assert.equal((people.match(/<li /g) ?? []).length, 2);
    assert.doesNotMatch(people, /在港口生活|在饭馆工作|照料盆景|创作墨轴|未能确认/);
    const background = renderToStaticMarkup(React.createElement(WorldCharacterBackgroundSections, { source: input }));
    for (const [group, prose] of [['life', '在港口生活。'], ['life', '在饭馆工作。'], ['objects', '照料盆景。']] as const) {
      const start = background.indexOf(`data-testid="world-character-${group}-list"`);
      assert.ok(start >= 0);
      assert.ok(background.slice(start, background.indexOf('</ul>', start)).includes(prose));
    }
    assert.doesNotMatch(background, /友人相助|创作墨轴|未能确认|world-character-works|world-character-background/);
  }
  source.characterProfile.relationshipNotes = source.characterProfile.relationshipNotes.slice(2);
  assert.equal(renderToStaticMarkup(React.createElement(WorldCharacterRelationshipCluesSection, { source })), '');
});

test('incoming person relationships use the other endpoint and survive more than twelve non-person rows', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    relationshipTargets: { friend: { kind: 'person', name: '友人' }, port: { kind: 'place', name: '港口' } },
    relationships: [
      ...Array.from({ length: 13 }, (_, i) => ({ id: `place-${i}`, type: 'inhabits', targetEntityId: 'port', summary: `地点记录 ${i}` })),
      { id: 'incoming', type: 'custom-bond', sourceEntityId: 'friend', targetEntityId: 'cbdb-person-99984',
        core: { attributes: { targetLabel: '欧阳德' }, presentation: { summary: '友人与欧阳德交游。' } } },
    ],
  }, 'source_materialization_available');
  const markup = renderToStaticMarkup(React.createElement(WorldCharacterRelationshipCluesSection, { source }));
  assert.match(markup, /友人与欧阳德交游。/);
  assert.match(markup, />友人<\/p>[\s\S]*>custom-bond<\/p>/);
  assert.doesNotMatch(markup, /地点记录|欧阳德 · custom-bond/);
});

test('relationship text localizes type identifiers and keeps authored descriptions', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.relationshipClues = [{
      id: 'caretaker', type: 'caretaker-of', label: 'caretaker-of',
      targetEntityId: null, targetLabel: null, summary: '亲手修桩侍弄红山茶盆景。', details: [],
    }];
    source.characterProfile = {
      ...source.characterProfile,
      relationshipNotes: [
        { id: 'spouse', type: 'spouses', targetRef: 'person-fang', summary: '方婉仪与罗聘为夫妻。' },
        { id: 'collaboration', type: 'co-creator-of', targetRef: null, summary: '两人合作绘制花卉图卷。' },
        { id: 'trading', type: 'trades-at', targetRef: null, summary: '在小秦淮河桥头摆摊。' },
        { id: 'mentor', type: 'mentor-and-supervisor', targetRef: null, summary: '带自己出师的师傅和顶头上司。' },
        { id: 'creator', type: 'creator-of', targetRef: null, summary: '亲手绘制的瘦竹墨轴。' },
        { id: 'neighbor', type: 'neighborly-cooperation', targetRef: null, summary: '邻里之间互通水流消息。' },
        { id: 'custom', type: 'custom-world-relation', targetRef: null, summary: '雨天会帮邻家收摊。' },
      ],
    };
    source.relationshipTargetLabels = { 'person-fang': '方婉仪' };
    source.relationshipTargets = { 'person-fang': { kind: 'person', name: '方婉仪' } };
    const markup = renderToStaticMarkup(React.createElement(AllRelationshipSections, { source }));
    const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');
    assert.match(visibleMarkup, />方婉仪<\/p>[\s\S]*>夫妻<\/p>/);
    assert.doesNotMatch(visibleMarkup, /共同创作|两人合作绘制花卉图卷|亲手绘制的瘦竹墨轴/);
    assert.match(visibleMarkup, /方婉仪与罗聘为夫妻。/);
    for (const [prose, context] of [
      ['在小秦淮河桥头摆摊。', '经营地点'],
    ]) {
      assert.ok(visibleMarkup.includes(`<p>${prose}<span`));
      assert.ok(visibleMarkup.includes(`（${context}）`));
    }
    assert.match(visibleMarkup, /<h2[^>]*>相关角色<\/h2>/);
    assert.doesNotMatch(visibleMarkup, /关系线索|<svg|<\/span>：/);
    assert.doesNotMatch(visibleMarkup, /相关线索|spouses|co-creator-of|caretaker-of|trades-at|mentor-and-supervisor|creator-of|neighborly-cooperation|<button|aria-pressed/);
    assert.doesNotMatch(markup, /world-character-relationship-map|world-character-relationship-cards/);
  } finally {
    await changeLocale('en');
  }
});

test('world character relationship text omits unresolved background without extracting names from prose', () => {
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
  assert.equal(associationClue?.type, 'association');
  assert.equal(associationClue?.label, '墓誌銘由劉智所作');
  assert.equal(associationClue?.targetLabel, null);

  assert.doesNotMatch(markup, /world-character-background-list|墓誌銘由劉智所作|墓志铭由刘智所作|刘智与欧阳德存在交游或关联记录。/);
});

test('relationship clues merge the same typed target across world rows and profile notes without losing details', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      relationships: [
        {
          id: 'world-care', type: 'caretaker-of', targetEntityId: 'red-camellia',
          summary: '亲手修桩侍弄红山茶盆景。',
          core: { attributes: { firstYear: 1762 } },
        },
        {
          id: 'world-care-extra', type: 'caretaker-of', targetEntityId: 'red-camellia',
          summary: '亲手修桩侍弄红山茶盆景。',
          core: { attributes: { firstYear: 1763 } },
        },
        {
          id: 'world-care-named', type: 'caretaker-of', targetEntityId: 'red-camellia',
          summary: '这盆山茶已经养了两年。',
          core: { attributes: { targetLabel: '红山茶' } },
        },
      ],
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        relationshipNotes: [
          { id: 'profile-care', type: 'caretaker-of', targetRef: 'red-camellia', summary: '执意自留赏玩，不愿出售。' },
          { id: 'profile-care-repeat', type: 'caretaker-of', targetRef: 'red-camellia', summary: '亲手修桩侍弄红山茶盆景。' },
        ],
      },
    }, 'source_materialization_available');
    source.relationshipTargets['red-camellia'] = { kind: 'plant', name: '红山茶' };
    const markup = renderToStaticMarkup(React.createElement(AllRelationshipSections, { source }));
    assert.equal((markup.match(/<li /g) ?? []).length, 1);
    assert.match(markup, /红山茶 · 照料/);
    assert.equal((markup.match(/亲手修桩侍弄红山茶盆景。/g) ?? []).length, 1);
    assert.match(markup, /这盆山茶已经养了两年。/);
    assert.match(markup, /执意自留赏玩，不愿出售。/);
    assert.match(markup, /1762/);
    assert.match(markup, /1763/);
    assert.doesNotMatch(markup, /red-camellia/);
  } finally {
    await changeLocale('en');
  }
});

test('relationship merging keeps different targets, types and unidentified relationships separate', () => {
  const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
  source.relationshipClues = [];
  source.relationshipTargetLabels = { 'plant-a': '山茶', 'plant-b': '山茶' };
  source.characterProfile = {
    ...source.characterProfile,
    relationshipNotes: [
      { id: 'care-a', type: 'caretaker-of', targetRef: 'plant-a', summary: '照料山茶。' },
      { id: 'care-b', type: 'caretaker-of', targetRef: 'plant-b', summary: '照料山茶。' },
      { id: 'owns-a', type: 'possesses', targetRef: 'plant-a', summary: '持有山茶。' },
      { id: 'unknown-a', type: 'caretaker-of', targetRef: null, summary: '修剪枝条。' },
      { id: 'unknown-b', type: 'caretaker-of', targetRef: null, summary: '浇水松土。' },
      { id: 'unknown-copy', type: 'caretaker-of', targetRef: null, summary: '浇水松土。' },
      { id: 'untyped-a', type: '', targetRef: 'plant-a', summary: '观赏花色。' },
      { id: 'untyped-b', type: '', targetRef: 'plant-a', summary: '记录花期。' },
    ],
  };
  const items = buildRelationshipClueItems(source, i18n.t.bind(i18n));
  const markup = JSON.stringify(items);
  assert.equal(items.length, 7);
  assert.equal((markup.match(/照料山茶。/g) ?? []).length, 2);
  for (const text of ['持有山茶。', '修剪枝条。', '浇水松土。', '观赏花色。', '记录花期。']) {
    assert.equal(markup.split(text).length - 1, 1);
  }
});

test('world character relationship text preserves posted address clues and their details', () => {
  const source = toSourceDetailData({
    ...ouYangDeRaw,
    characterProfile: {
      ...ouYangDeRaw.characterProfile,
      relationshipNotes: [],
    },
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

  assert.deepEqual(source.relationshipClues.map((clue) => [clue.type, clue.label, clue.details]), [
    ['postedAddress', '京兆府', ['翰林学士', '1086']],
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
  const mapStart = markup.indexOf('data-testid="world-character-life-list"');
  const mapEnd = markup.indexOf('</ul>', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);
  const cardStart = markup.indexOf('data-testid="world-character-life-clue-postedAddress"');
  const cardEnd = markup.indexOf('</li>', cardStart);
  const cardMarkup = markup.slice(cardStart, cardEnd);

  assert.match(mapMarkup, /京兆府/);
  assert.doesNotMatch(mapMarkup, /<svg|<button|aria-pressed/);
  assert.doesNotMatch(mapMarkup, /lucide-user-round/);
  assert.match(cardMarkup, /1086/);
  assert.match(cardMarkup, /翰林学士/);
  assert.match(cardMarkup, /京兆府/);
  assert.doesNotMatch(cardMarkup, /lucide-user-round/);
});

test('world character relationship text localizes kinship kind labels', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData({
      ...ouYangDeRaw,
      characterProfile: {
        ...ouYangDeRaw.characterProfile,
        relationshipNotes: [],
      },
      relationships: [
        {
          id: 'cbdb-rel-99984-kinship-wen-shi-1',
          type: 'kinship',
          sourceEntityId: 'cbdb-person-99984',
          targetEntityId: 'cbdb-person-wen-shi',
          contentHash: 'rel-kinship-wen-shi-hash',
          core: {
            presentation: {
              summary: '温氏与欧阳德存在亲属关系。',
            },
            attributes: {
              targetLabel: '温氏',
              rowRef: 'cbdb:KINSHIP_DATA:99984:wen-shi:1',
              joinStatus: 'resolved',
            },
          },
        },
      ],
    }, 'source_materialization_available');
    source.relationshipTargets['cbdb-person-wen-shi'] = { kind: 'person', name: '温氏' };
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

    assert.match(markup, />温氏<\/p>[\s\S]*>亲属<\/p>/);
    assert.doesNotMatch(markup, />kinship</);
    assert.doesNotMatch(markup, /围绕亲属展开/);
  } finally {
    await changeLocale('en');
  }
});

test('world character relationship text never renders raw target entity ids from profile notes', () => {
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

  const mapStart = markup.indexOf('data-testid="world-character-life-list"');
  const mapEnd = markup.indexOf('</ul>', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);

  assert.doesNotMatch(mapMarkup, /cbdb-status-181/);
  assert.doesNotMatch(mapMarkup, /cbdb-office-70625/);
  assert.doesNotMatch(mapMarkup, /cbdb-text-28102/);
  assert.match(mapMarkup, /礼部尚书/);
  assert.match(mapMarkup, /理学家 - 阳明学派/);
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

  assert.doesNotMatch(markup, /Life milestones/);
  assert.doesNotMatch(markup, /data-testid="world-character-milestones-section"/);
  assert.doesNotMatch(markup, /<h2[^>]*>Character relationships<\/h2>/);
  assert.match(markup, /<h2[^>]*>Life and work<\/h2>/);
  assert.match(markup, /1545/);
  assert.match(markup, /欧阳南野先生文集/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-list"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-map"|aria-pressed/);
  assert.doesNotMatch(markup, /data-testid="world-character-career-derived-node"/);
  assert.match(markup, /data-testid="world-character-life-clue-postedToOffice"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-clue-text"/);
  assert.doesNotMatch(visibleMarkup, /cbdb-rel-99984/);
  assert.doesNotMatch(visibleMarkup, /cbdb:BIOG_TEXT_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:POSTED_TO_OFFICE_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:STATUS_DATA/);
  assert.doesNotMatch(visibleMarkup, /Friends/);
  assert.doesNotMatch(visibleMarkup, /Posts/);
  assert.doesNotMatch(visibleMarkup, /Likes/);
});
