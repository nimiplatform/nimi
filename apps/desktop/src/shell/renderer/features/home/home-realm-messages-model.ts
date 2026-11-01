import type { NimiRealmNotificationItemView } from '@nimiplatform/sdk/realm';
import type { ContactRow } from '../relationship/human-contact-data.js';
import type { HomeRealmMessage } from './home-messages-model.js';

/** Current requests remain discoverable even when their notification page is not loaded. */
export function projectRealmMessages(notifications: readonly NimiRealmNotificationItemView[], requests: readonly ContactRow[]): HomeRealmMessage[] {
  const pending = new Map<string, HomeRealmMessage>();
  for (const request of requests) {
    if (!request.relationshipId) continue;
    pending.set(request.relationshipId, { key: `realm-request:${request.relationshipId}`, groupKey: 'realm',
      sourceKind: 'realm', request, notifications: [], time: request.requestedAt ?? null });
  }
  const history: HomeRealmMessage[] = [];
  for (const notification of new Map(notifications.map(item => [item.id, item])).values()) {
    const request = notification.type === 'friend_request_received' && notification.relationshipId
      ? pending.get(notification.relationshipId) : undefined;
    if (request) pending.set(notification.relationshipId!, { ...request, notifications: [...request.notifications, notification] });
    else history.push({ key: `realm-notification:${notification.id}`, groupKey: 'realm', sourceKind: 'realm', request: null,
      notifications: [notification], time: notification.createdAt });
  }
  return [...pending.values(), ...history];
}

export function realmMessageAccount(message: HomeRealmMessage) {
  const notification = message.notifications[0];
  return message.request ? { id: message.request.id, name: message.request.displayName || message.request.handle || '', avatarUrl: message.request.avatarUrl }
    : { id: notification?.target?.accountId || notification?.actorId || null,
      name: notification?.actorName || '', avatarUrl: notification?.actorAvatarUrl || null };
}
