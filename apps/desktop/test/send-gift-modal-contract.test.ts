import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const modalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/economy/send-gift-modal.tsx'),
  'utf8',
);
const profileCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/message-timeline-profile-card.tsx'),
  'utf8',
);
const enLocale = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/locales/en.json'),
  'utf8',
)) as Record<string, Record<string, string>>;
const zhLocale = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/locales/zh.json'),
  'utf8',
)) as Record<string, Record<string, string>>;

test('send gift modal loads dynamic gift catalog and sends selected gift ids', () => {
  assert.match(modalSource, /useQuery\(\{/);
  assert.match(modalSource, /queryKey:\s*\['gift-catalog'\]/);
  assert.match(modalSource, /normalizeGiftCatalog\(await dataSync\.loadGiftCatalog\(\)\)/);
  assert.match(modalSource, /giftId:\s*selectedGiftId/);
  assert.doesNotMatch(modalSource, /giftId:\s*'gem'/);
  assert.doesNotMatch(modalSource, /\bgemAmount\b/);
  assert.doesNotMatch(modalSource, /amount:\s*gemAmount/);
});

test('send gift modal renders explicit loading, failure, retry, and empty catalog states', () => {
  assert.match(modalSource, /catalogQuery\.isPending && giftOptions\.length === 0/);
  assert.match(modalSource, /catalogQuery\.isError && giftOptions\.length === 0/);
  assert.match(modalSource, /void catalogQuery\.refetch\(\)/);
  assert.match(modalSource, /giftOptions\.length === 0/);
});

test('gifting copy uses gift and spark language instead of direct gem transfer language', () => {
  assert.match(modalSource, /GiftSend\.sendGift/);
  assert.match(modalSource, /GiftSend\.sparkCost/);
  assert.match(modalSource, /GiftSend\.sparkUnit/);
  assert.doesNotMatch(modalSource, /GiftSend\.sendGem/);
  assert.doesNotMatch(modalSource, /GiftSend\.gemAmount/);
  assert.match(profileCardSource, /GiftSend\.sendGift/);
  assert.doesNotMatch(profileCardSource, /GiftSend\.sendGem/);
  assert.equal(enLocale.GiftSend?.sendGift, 'Send Gift');
  assert.equal(zhLocale.GiftSend?.sendGift, '送礼物');
  assert.equal(enLocale.GiftSend?.sparkUnit, 'SPARK');
  assert.equal(zhLocale.GiftSend?.sparkUnit, 'SPARK');
  assert.equal(enLocale.GiftSend?.sendGem, undefined);
  assert.equal(zhLocale.GiftSend?.sendGem, undefined);
});
