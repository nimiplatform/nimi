import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const giftBubbleSource = readSource('../src/shell/renderer/features/economy/gift-message-bubble.tsx');
const giftInboxSource = readSource('../src/shell/renderer/features/economy/gift-inbox-panel.tsx');
const walletPageSource = readSource('../src/shell/renderer/features/settings/settings-advanced-panel.tsx');
const exploreRecommendationSource = readSource('../src/shell/renderer/features/explore/explore-persona-source-card.tsx');

test('gift actions require loaded Realm transaction evidence', () => {
  assert.match(giftBubbleSource, /loadRealmGiftTransaction/);
  assert.match(giftBubbleSource, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(giftBubbleSource, /const hasRealmTransactionEvidence = Boolean\(tx\?\.id\)/);
  assert.match(giftBubbleSource, /txQuery\.isError \|\| !hasRealmTransactionEvidence/);
  assert.match(giftBubbleSource, /GiftBubble\.realmEvidenceRequired/);
  assert.doesNotMatch(giftBubbleSource, /dataSync\.loadGiftTransaction/);
  assert.doesNotMatch(giftBubbleSource, /const isReceiver = tx \? tx\.receiverId === currentUserId : !isMe/);
});

test('gift inbox injects the Desktop Realm commerce service into Kit hook', () => {
  assert.match(giftInboxSource, /useRealmGiftInbox\(\{/);
  assert.match(giftInboxSource, /createRealmCommerceGiftService/);
  assert.match(giftInboxSource, /generated: sdk\.realm\(\)\.generated/);
  assert.match(giftInboxSource, /service:\s*giftService/);
});

test('wallet checkout return does not claim local success before Realm evidence', () => {
  assert.match(walletPageSource, /loadRealmCurrencyBalances/);
  assert.match(walletPageSource, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(walletPageSource, /createRealmCommerceGiftService/);
  assert.match(walletPageSource, /loadRealmCurrencyBalances\(\{ service: giftService \}\)/);
  assert.doesNotMatch(walletPageSource, /dataSync\.loadCurrencyBalances/);
  assert.match(walletPageSource, /Wallet\.rechargeReturnRequiresRealmEvidence/);
  assert.match(walletPageSource, /void refreshSparkWalletSnapshot\(\)/);
  assert.doesNotMatch(walletPageSource, /checkoutStatus === 'success'\s*\?\s*t\('Wallet\.rechargeCheckoutSuccess'/);
});

test('explore recommendation card delegates Realm source primary action without local friendship state', () => {
  assert.doesNotMatch(exploreRecommendationSource, /setFriendship\('pending'\)/);
  assert.doesNotMatch(exploreRecommendationSource, /setFriendship\('friend'\)/);
  assert.match(exploreRecommendationSource, /void onPrimaryAction\?\.\(\)/);
});
