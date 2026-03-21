import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/notification/notification-panel.tsx',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('notification panel action wiring', () => {
  test('friend request actions call the social data-sync flows', () => {
    assert.match(source, /const actorId = item\.actorId;/);
    assert.match(source, /dataSync\.requestOrAcceptFriend\(actorId\)/);
    assert.match(source, /dataSync\.rejectOrRemoveFriend\(actorId\)/);
  });

  test('gift actions use explicit accept and reject flows', () => {
    assert.match(source, /dataSync\.acceptGift\(item\.giftTransactionId as string\)/);
    assert.match(source, /dataSync\.rejectGift\(rejectingItem\.giftTransactionId as string/);
    assert.match(source, /navigateToGiftInbox\(item\.giftTransactionId\)/);
  });

  test('positive and negative gift reviews are wired separately', () => {
    assert.match(source, /ReviewRatingEnum\.POSITIVE/);
    assert.match(source, /ReviewRatingEnum\.NEGATIVE/);
  });

  test('notification panel renders a distinct load error state', () => {
    assert.match(source, /notificationsQuery\.isError && items\.length === 0/);
    assert.match(source, /NotificationPanel\.loadError/);
  });

  test('notification list stays query-backed instead of duplicating page state in local items state', () => {
    assert.match(source, /useInfiniteQuery\(/);
    assert.doesNotMatch(source, /const \[items,\s*setItems\]/);
  });
});
