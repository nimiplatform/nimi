import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const contactsViewSource = readSource('../src/shell/renderer/features/contacts/contacts-view.tsx');
const contactsPanelSource = readSource('../src/shell/renderer/features/contacts/contacts-panel.tsx');
const giftBubbleSource = readSource('../src/shell/renderer/features/economy/gift-message-bubble.tsx');
const walletPageSource = readSource('../src/shell/renderer/features/settings/settings-advanced-panel.tsx');
const exploreRecommendationSource = readSource('../src/shell/renderer/features/explore/explore-agent-recommendation-card.tsx');

test('contacts request UI updates local outcome only after data-sync evidence resolves', () => {
  assert.match(contactsViewSource, /const acceptRequestWithEvidence = async \(request: ContactRequestRecord\) => \{\s*await props\.onAcceptRequest\(request\);\s*setAcceptedRequests/s);
  assert.match(contactsViewSource, /const rejectRequestWithEvidence = async \(request: ContactRequestRecord\) => \{\s*await props\.onRejectRequest\(request\);\s*setRejectedRequests/s);
  assert.match(contactsPanelSource, /throw error instanceof Error \? error : new Error\(message\);/);
  assert.doesNotMatch(contactsViewSource, /onAcceptRequest=\{\(request\) => \{\s*props\.onAcceptRequest\(request\);\s*setAcceptedRequests/s);
  assert.doesNotMatch(contactsViewSource, /onRejectRequest=\{\(request\) => \{\s*props\.onRejectRequest\(request\);\s*setRejectedRequests/s);
});

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
