import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const modalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/economy/send-gift-modal.tsx'),
  'utf8',
);
const commerceRealmSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/features/commerce/src/realm.ts'),
  'utf8',
);
const sendGiftHookSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/features/commerce/src/hooks/use-send-gift-dialog.ts'),
  'utf8',
);
const sendGiftDialogSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/features/commerce/src/components/send-gift-dialog.tsx'),
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
  assert.match(modalSource, /useRealmSendGiftDialog\(\{/);
  assert.match(commerceRealmSource, /return useSendGiftDialog\(\{/);
  assert.match(sendGiftHookSource, /await adapter\.sendGift\(\{/);
  assert.match(sendGiftHookSource, /giftId:\s*selectedGiftId/);
  assert.doesNotMatch(modalSource, /giftId:\s*'gem'/);
  assert.doesNotMatch(modalSource, /\bgemAmount\b/);
  assert.doesNotMatch(modalSource, /amount:\s*gemAmount/);
});

test('send gift modal renders explicit loading, failure, retry, and empty catalog states', () => {
  assert.match(sendGiftDialogSource, /state\.catalogLoading/);
  assert.match(sendGiftDialogSource, /state\.catalogError/);
  assert.match(sendGiftDialogSource, /state\.isCatalogEmpty/);
  assert.match(sendGiftDialogSource, /void state\.refreshCatalog\(\)/);
});

test('send gift modal uses a synchronous ref guard to block double-submit races', () => {
  assert.match(sendGiftHookSource, /useRef/);
  assert.match(sendGiftHookSource, /const sendingRef = useRef\(false\)/);
  assert.match(sendGiftHookSource, /if \(sendingRef\.current \|\| !selectedGiftId \|\| !receiverId\.trim\(\)\)/);
  assert.match(sendGiftHookSource, /sendingRef\.current = true/);
  assert.match(sendGiftHookSource, /sendingRef\.current = false/);
});

test('send gift modal uses explicit receiverIsAgent instead of handle-prefix inference', () => {
  assert.match(modalSource, /receiverIsAgent\?: boolean;/);
  assert.match(modalSource, /kind=\{props\.receiverIsAgent === true \? 'agent' : 'human'\}/);
  assert.doesNotMatch(modalSource, /startsWith\('~'\)/);
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
