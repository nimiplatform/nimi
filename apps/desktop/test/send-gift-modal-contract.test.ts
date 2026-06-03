import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readDesktopLocale } from './helpers/read-desktop-locale';

const modalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/economy/send-gift-modal.tsx'),
  'utf8',
);
const profileCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/message-timeline-profile-card.tsx'),
  'utf8',
);
const enLocale = readDesktopLocale('en') as Record<string, Record<string, string>>;
const zhLocale = readDesktopLocale('zh') as Record<string, Record<string, string>>;

test('send gift modal loads dynamic gift catalog and sends selected gift ids', () => {
  assert.match(modalSource, /useRealmSendGiftDialog\(\{/);
  assert.doesNotMatch(modalSource, /giftId:\s*'gem'/);
  assert.doesNotMatch(modalSource, /\bgemAmount\b/);
  assert.doesNotMatch(modalSource, /amount:\s*gemAmount/);
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
