import assert from 'node:assert/strict';
import test from 'node:test';
import { worldCharacterHeroSubtitle } from '../src/shell/renderer/features/source-detail/source-detail-world-character-labels.js';
import type { SourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';

test('dynasty aliases respect complete words in source labels', () => {
 for (const [worldId, expected] of [['qing','清代'],['qing-dynasty','清代'],['beijing',null],['ming-dynasty','明代'],['清代','清代']] as const) {
  const source = {worldId, characterProfile:{archetype:null,role:null}, entity:null,bio:null,tags:[]} as unknown as SourceDetailData;
  assert.equal(worldCharacterHeroSubtitle(source),expected);
 }
});
