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

test.before(async () => {
  await initI18n();
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
