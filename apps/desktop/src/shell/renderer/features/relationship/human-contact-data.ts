import type { Realm, RealmModel } from '@nimiplatform/sdk/realm';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export type ContactTab = 'friends' | 'received' | 'sent' | 'blocked';
export type ContactSection = ContactTab | 'conversations';
export type ContactRow = {
  id: string;
  relationshipId: string | null;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarMedia?: RealmModel<'MediaDeliveryDto'> | null;
  isDeleted: boolean;
  requestMessage?: string | null;
};
export type ContactPage = { items: ContactRow[]; nextCursor: string | null; total: number };

export async function loadHumanContactPage(realm: Realm, tab: ContactTab, cursor: string, search: string): Promise<ContactPage> {
  const query = { limit: 30, ...(cursor ? { cursor } : {}) };
  if (tab === 'friends') {
    const page = await realm.generated.listMyFriendsWithDetails({ path: {}, query: { ...query, ...(search ? { query: search } : {}) } });
    return { ...page, items: page.items.map(row => ({ ...row, avatarUrl: row.avatarUrl ?? null })) };
  }
  if (tab === 'blocked') {
    const page = await realm.generated.getMyBlockedUsers({ path: {}, query });
    return { ...page, items: page.items.map(row => ({ ...row, relationshipId: null })) };
  }
  const page = await realm.generated.getMyPendingFriendRequests({ path: {}, query: { ...query, direction: tab } });
  return { ...page, items: page.items.map(row => ({ ...row, id: row.userId })) };
}

export function useReceivedFriendRequests() {
  const bindings = useDesktopRendererBindings();
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  const authenticated = useAppStore(state => state.auth.status === 'authenticated');
  return useInfiniteQuery({
    queryKey: ['human-contacts', realmBaseUrl, accountId, 'received', ''], initialPageParam: '',
    queryFn: ({ pageParam }) => loadHumanContactPage(bindings.sdk.realm(), 'received', pageParam, ''),
    getNextPageParam: page => page.nextCursor || undefined,
    enabled: authenticated && Boolean(accountId), staleTime: 30_000, refetchInterval: 30_000,
  });
}
