import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGiftCatalog,
  resolveSelectedGiftId,
} from '../src/shell/renderer/features/economy/send-gift-modal-model';

test('normalizeGiftCatalog accepts array and item-wrapper payloads', () => {
  const fromArray = normalizeGiftCatalog([
    { id: 'rose', name: 'Rose', sparkCost: '25', emoji: '🌹' },
    { id: 'coffee', sparkCost: 10 },
  ]);
  const fromItemsWrapper = normalizeGiftCatalog({
    items: [{ id: 'rocket', name: 'Rocket', sparkCost: '100', iconUrl: 'https://nimi.test/rocket.png' }],
  });

  assert.deepEqual(fromArray, [
    { id: 'rose', name: 'Rose', sparkCost: 25, emoji: '🌹', iconUrl: null },
    { id: 'coffee', name: 'coffee', sparkCost: 10, emoji: '🎁', iconUrl: null },
  ]);
  assert.deepEqual(fromItemsWrapper, [
    {
      id: 'rocket',
      name: 'Rocket',
      sparkCost: 100,
      emoji: '🎁',
      iconUrl: 'https://nimi.test/rocket.png',
    },
  ]);
});

test('normalizeGiftCatalog drops entries without id or spark cost', () => {
  const result = normalizeGiftCatalog([
    { id: '', name: 'Invalid', sparkCost: '25' },
    { id: 'missing-cost', name: 'Invalid' },
    { id: 'good', name: 'Valid', sparkCost: '12.5', emoji: '🎁' },
  ]);

  assert.deepEqual(result, [
    { id: 'good', name: 'Valid', sparkCost: 12.5, emoji: '🎁', iconUrl: null },
  ]);
});

test('resolveSelectedGiftId keeps valid selection and falls back to the first gift', () => {
  const items = normalizeGiftCatalog([
    { id: 'rose', name: 'Rose', sparkCost: '25' },
    { id: 'rocket', name: 'Rocket', sparkCost: '100' },
  ]);

  assert.equal(resolveSelectedGiftId(items, 'rocket'), 'rocket');
  assert.equal(resolveSelectedGiftId(items, 'missing'), 'rose');
  assert.equal(resolveSelectedGiftId([], 'rocket'), '');
});
