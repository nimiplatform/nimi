import type { StoreActionContext } from './action-context';
import type { ContactsState } from '../store-types';
import { persistBlockedContactsToStorage } from '../slices/initial-state';

export function setContactsState(
  ctx: StoreActionContext,
  contacts: Partial<Pick<ContactsState, 'friends' | 'agents' | 'groups' | 'pendingReceived' | 'pendingSent' | 'blocked'>>,
) {
  ctx.state.contacts = {
    ...ctx.state.contacts,
    ...contacts,
    isLoading: false,
  };
  ctx.emit('contactsChange', ctx.state.contacts);
}

export function addBlockedContactState(
  ctx: StoreActionContext,
  contact: Record<string, unknown>,
) {
  const currentBlocked = ctx.state.contacts.blocked || [];
  // 避免重复添加
  if (currentBlocked.some((c) => c.id === contact.id)) {
    return;
  }
  const newBlocked = [...currentBlocked, contact];
  ctx.state.contacts.blocked = newBlocked;
  persistBlockedContactsToStorage(newBlocked);
  ctx.emit('contactsChange', ctx.state.contacts);
}

export function removeBlockedContactState(
  ctx: StoreActionContext,
  contactId: string,
) {
  const newBlocked = (ctx.state.contacts.blocked || []).filter(
    (c) => c.id !== contactId,
  );
  ctx.state.contacts.blocked = newBlocked;
  persistBlockedContactsToStorage(newBlocked);
  ctx.emit('contactsChange', ctx.state.contacts);
}

export function setContactsLoadingState(ctx: StoreActionContext, loading: boolean) {
  ctx.state.contacts.isLoading = loading;
  ctx.emit('contactsChange', ctx.state.contacts);
}

export function setExploreItemsState(
  ctx: StoreActionContext,
  items: Array<Record<string, unknown>>,
  cursor: string | null,
  hasMore: boolean,
) {
  ctx.state.explore = {
    ...ctx.state.explore,
    items,
    cursor,
    hasMore,
    isLoading: false,
  };
  ctx.emit('exploreChange', ctx.state.explore);
}

export function appendExploreItemsState(
  ctx: StoreActionContext,
  items: Array<Record<string, unknown>>,
  cursor: string | null,
  hasMore: boolean,
) {
  ctx.state.explore.items.push(...items);
  ctx.state.explore.cursor = cursor;
  ctx.state.explore.hasMore = hasMore;
  ctx.state.explore.isLoading = false;
  ctx.emit('exploreChange', ctx.state.explore);
}

export function setExploreLoadingState(ctx: StoreActionContext, loading: boolean) {
  ctx.state.explore.isLoading = loading;
  ctx.emit('exploreChange', ctx.state.explore);
}

export function setExploreTagState(ctx: StoreActionContext, tag: string | null) {
  ctx.state.explore.currentTag = tag;
  ctx.state.explore.items = [];
  ctx.state.explore.cursor = null;
  ctx.emit('exploreChange', ctx.state.explore);
}
