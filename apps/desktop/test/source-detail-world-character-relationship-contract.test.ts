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
import { WorldCharacterRelationshipCluesSection } from '../src/shell/renderer/features/source-detail/source-detail-world-character-relationship-clues.js';

test.before(async () => {
  await initI18n();
});

test('relationship text localizes spouses and creative collaboration and removes graph controls', async () => {
  await changeLocale('zh');
  try {
    const source = toSourceDetailData(ouYangDeRaw, 'source_materialization_available');
    source.relationshipClues = [];
    source.characterProfile = {
      ...source.characterProfile,
      relationshipNotes: [
        { id: 'spouse', type: 'spouses', targetRef: 'person-fang', summary: '方婉仪与罗聘为夫妻。' },
        { id: 'collaboration', type: 'co-creator-of', targetRef: null, summary: '两人合作绘制花卉图卷。' },
      ],
    };
    source.relationshipTargetLabels = { 'person-fang': '方婉仪' };
    const markup = renderToStaticMarkup(React.createElement(WorldCharacterRelationshipCluesSection, { source }));
    const visibleMarkup = markup.replace(/\sdata-[^=]+="[^"]*"/gu, '');
    assert.match(visibleMarkup, /方婉仪 · 夫妻/);
    assert.match(visibleMarkup, /共同创作/);
    assert.match(visibleMarkup, /方婉仪与罗聘为夫妻。/);
    assert.match(visibleMarkup, /两人合作绘制花卉图卷。/);
    assert.doesNotMatch(visibleMarkup, /spouses|co-creator-of|<button|aria-pressed/);
    assert.doesNotMatch(markup, /world-character-relationship-map|world-character-relationship-cards/);
  } finally {
    await changeLocale('en');
  }
});

test('world character relationship text shows explicit relation labels as authored without extracting names from prose', () => {
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

  const mapStart = markup.indexOf('data-testid="world-character-relationship-list"');
  const mapEnd = markup.indexOf('</ul>', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);

  // Keep authored relationship wording without inventing a person name.
  assert.match(mapMarkup, /墓誌銘由劉智所作/);
  assert.doesNotMatch(mapMarkup, />劉智</);
  assert.doesNotMatch(markup, /墓志铭由刘智所作/);
  assert.match(markup, /刘智与欧阳德存在交游或关联记录。/);
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
  const mapStart = markup.indexOf('data-testid="world-character-relationship-list"');
  const mapEnd = markup.indexOf('</ul>', mapStart);
  const mapMarkup = markup.slice(mapStart, mapEnd);
  const cardStart = markup.indexOf('data-testid="world-character-relationship-clue-postedAddress"');
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

    assert.match(markup, /温氏 · 亲属/);
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

  const mapStart = markup.indexOf('data-testid="world-character-relationship-list"');
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

  assert.match(markup, /Life milestones/);
  assert.match(markup, /data-testid="world-character-milestones-timeline"/);
  assert.match(markup, /Relationship clues/);
  assert.match(markup, /嘉靖二年（1523）中进士/);
  assert.match(markup, /1554/);
  assert.match(markup, /1545/);
  assert.match(markup, /欧阳南野先生文集/);
  assert.match(markup, /data-testid="world-character-relationship-list"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-map"|aria-pressed/);
  assert.match(markup, /data-testid="world-character-career-derived-node"/);
  assert.match(markup, /data-testid="world-character-relationship-clue-postedToOffice"/);
  assert.doesNotMatch(markup, /data-testid="world-character-relationship-clue-text"/);
  assert.doesNotMatch(visibleMarkup, /cbdb-rel-99984/);
  assert.doesNotMatch(visibleMarkup, /cbdb:BIOG_TEXT_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:POSTED_TO_OFFICE_DATA/);
  assert.doesNotMatch(visibleMarkup, /cbdb:STATUS_DATA/);
  assert.doesNotMatch(visibleMarkup, /Friends/);
  assert.doesNotMatch(visibleMarkup, /Posts/);
  assert.doesNotMatch(visibleMarkup, /Likes/);
});
