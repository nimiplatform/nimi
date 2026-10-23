import type { RealmApiCaller } from '../social/data/social-snapshot.js';
import type { Realm } from '@nimiplatform/sdk/realm';

export type FriendHandleRequestResult = Awaited<ReturnType<Realm['social']['addFriendByHandle']>>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r018
export async function requestFriendByHandle(callApi: RealmApiCaller, input: string): Promise<FriendHandleRequestResult> {
  const handle = input.trim().replace(/^@/, '');
  if (!handle) throw new Error('Enter the complete account handle.');
  const result = await callApi(
    (realm) => realm.social.addFriendByHandle({ path: { handle }, body: {} }),
    'Unable to confirm this friend request.',
  );
  if (!result || !['requested', 'accepted', 'unchanged'].includes(result.outcome)) {
    throw new Error('Realm returned an invalid friend request outcome.');
  }
  return { outcome: result.outcome };
}
