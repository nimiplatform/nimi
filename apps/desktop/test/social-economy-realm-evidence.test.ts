import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const giftBubbleSource = readSource('../src/shell/renderer/features/economy/gift-message-bubble.tsx');
const walletPageSource = readSource('../src/shell/renderer/features/settings/settings-advanced-panel.tsx');
const exploreRecommendationSource = readSource('../src/shell/renderer/features/explore/explore-agent-recommendation-card.tsx');

test('gift actions require loaded Realm transaction evidence', () => {
  assert.match(giftBubbleSource, /const hasRealmTransactionEvidence = Boolean\(tx\?\.id\)/);
  assert.match(giftBubbleSource, /txQuery\.isError \|\| !hasRealmTransactionEvidence/);
  assert.match(giftBubbleSource, /GiftBubble\.realmEvidenceRequired/);
  assert.doesNotMatch(giftBubbleSource, /const isReceiver = tx \? tx\.receiverId === currentUserId : !isMe/);
});

test('wallet checkout return does not claim local success before Realm evidence', () => {
  assert.match(walletPageSource, /Wallet\.rechargeReturnRequiresRealmEvidence/);
  assert.match(walletPageSource, /void refreshSparkWalletSnapshot\(\)/);
  assert.doesNotMatch(walletPageSource, /checkoutStatus === 'success'\s*\?\s*t\('Wallet\.rechargeCheckoutSuccess'/);
});

test('explore recommendation card does not promote local friendship state without mutation evidence', () => {
  assert.doesNotMatch(exploreRecommendationSource, /setFriendship\('pending'\)/);
  assert.doesNotMatch(exploreRecommendationSource, /setFriendship\('friend'\)/);
  assert.match(exploreRecommendationSource, /void onAddFriend\?\.\(\)/);
});
