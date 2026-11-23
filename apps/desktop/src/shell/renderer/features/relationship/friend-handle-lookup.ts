import type { RealmApiCaller } from '../social/data/social-snapshot.js';
import type { Realm } from '@nimiplatform/sdk/realm';

export type FriendHandleRequestResult = Awaited<ReturnType<Realm['social']['addFriendByHandle']>>;

export const MAX_FRIEND_REQUEST_MESSAGE_LENGTH = 200;

// @nimi-authority: rule.nimi.desktop.product-surfaces.r018
export async function requestFriendByHandle(
  callApi: RealmApiCaller,
  input: string,
  requestMessage?: string,
): Promise<FriendHandleRequestResult> {
  const handle = input.trim().replace(/^@+/, '');
  if (!handle) throw new Error('Enter the complete account handle.');
  const trimmedMessage = typeof requestMessage === 'string' ? requestMessage.trim() : '';
  if (trimmedMessage.length > MAX_FRIEND_REQUEST_MESSAGE_LENGTH) {
    throw new Error(`Friend request message must be ${MAX_FRIEND_REQUEST_MESSAGE_LENGTH} characters or fewer.`);
  }
  const body = trimmedMessage ? { requestMessage: trimmedMessage } : {};
  const result = await callApi(
    (realm) => realm.social.addFriendByHandle({ path: { handle }, body }),
    'Unable to confirm this friend request.',
  );
  if (!result || !['requested', 'accepted', 'unchanged'].includes(result.outcome)) {
    throw new Error('Realm returned an invalid friend request outcome.');
  }
  return { outcome: result.outcome };
}
