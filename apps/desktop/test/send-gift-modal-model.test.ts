import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEND_GIFT_MODAL_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/economy/send-gift-modal.tsx'),
  'utf8',
);

test('Desktop send gift modal consumes Kit commerce dialog model without owning catalog normalization', () => {
  assert.match(SEND_GIFT_MODAL_SOURCE, /useRealmSendGiftDialog/);
  assert.match(SEND_GIFT_MODAL_SOURCE, /SendGiftDialog/);
  assert.match(SEND_GIFT_MODAL_SOURCE, /@nimiplatform\/kit\/features\/commerce/);
  assert.doesNotMatch(SEND_GIFT_MODAL_SOURCE, /normalizeCommerceGiftCatalog/);
  assert.doesNotMatch(SEND_GIFT_MODAL_SOURCE, /resolveSelectedGiftId/);
});
