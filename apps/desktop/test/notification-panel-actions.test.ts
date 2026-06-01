import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/notification/notification-panel.tsx',
);
const QUERY_SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/notification/notification-query.ts',
);
const MAIN_LAYOUT_VIEW_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');
const querySource = readFileSync(QUERY_SOURCE_PATH, 'utf-8');
const mainLayoutViewSource = readFileSync(MAIN_LAYOUT_VIEW_PATH, 'utf-8');

describe('notification panel action wiring', () => {
  test('friend request actions call the social Realm data flows', () => {
    assert.match(source, /const actorId = item\.actorId;/);
    assert.match(source, /realmSocialData\.requestOrAcceptFriend\(actorId\)/);
    assert.match(source, /realmSocialData\.rejectOrRemoveFriend\(actorId\)/);
    assert.doesNotMatch(source, /dataSync\./);
  });

  test('gift actions use Kit commerce Realm helpers', () => {
    assert.match(source, /acceptRealmGift\(item\.giftTransactionId as string\)/);
    assert.match(source, /rejectRealmGift\(rejectingItem\.giftTransactionId as string/);
    assert.match(source, /createRealmGiftReview\(\{/);
    assert.doesNotMatch(source, /dataSync\.acceptGift/);
    assert.doesNotMatch(source, /dataSync\.rejectGift/);
    assert.doesNotMatch(source, /dataSync\.createGiftReview/);
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

  test('notification queries are scoped by stable authenticated identity', () => {
    assert.match(querySource, /resolveNotificationIdentityRef/);
    assert.match(querySource, /user\?\.id \?\? user\?\.accountId \?\? user\?\.subjectId \?\? user\?\.sub/);
    assert.match(querySource, /page: \(identityRef: string, serverFilter: string \| null\) =>/);
    assert.match(querySource, /topbarUnreadCount: \(identityRef: string\) =>/);
    assert.match(source, /queryKey: notificationQueryKeys\.page\(notificationQueryIdentityRef, serverFilter\)/);
    assert.match(source, /queryKey: notificationQueryKeys\.topbarUnreadCount\(notificationQueryIdentityRef\)/);
    assert.match(source, /enabled: authStatus === 'authenticated' && Boolean\(notificationIdentityRef\)/);
    assert.match(source, /patchNotificationUnreadCaches\(nextUnreadCount, notificationIdentityRef\)/);
    assert.match(mainLayoutViewSource, /queryKey: notificationQueryKeys\.topbarUnreadCount\(notificationQueryIdentityRef\)/);
    assert.match(mainLayoutViewSource, /enabled: props\.authStatus === 'authenticated' && Boolean\(notificationIdentityRef\)/);
  });
});
