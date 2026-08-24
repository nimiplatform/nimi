import type {
  NimiRealmCreatorEligibility,
  NimiRealmNotificationListView,
  NimiRealmNotificationUnreadView,
} from '@nimiplatform/sdk/realm';
import type { RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';

export type NotificationProjectionState =
  | { status: 'idle'; unread: null; error: null }
  | { status: 'loading'; unread: NimiRealmNotificationUnreadView | null; error: null }
  | { status: 'ready'; unread: NimiRealmNotificationUnreadView; error: null }
  | { status: 'error'; unread: null; error: string };

export type NotificationListProjectionState =
  | { status: 'idle'; list: null; error: null }
  | { status: 'loading'; list: NimiRealmNotificationListView | null; error: null }
  | { status: 'ready'; list: NimiRealmNotificationListView; error: null }
  | { status: 'error'; list: null; error: string };

export type AccountSettingsProjectionState =
  | { status: 'idle'; eligibility: null; error: null }
  | { status: 'loading'; eligibility: NimiRealmCreatorEligibility | null; error: null }
  | { status: 'ready'; eligibility: NimiRealmCreatorEligibility; error: null }
  | { status: 'error'; eligibility: null; error: string };

export type HumanChatProjectionState =
  | { status: 'idle'; chats: null; error: null }
  | { status: 'loading'; chats: RealmListChatsResultDto | null; error: null }
  | { status: 'ready'; chats: RealmListChatsResultDto; error: null }
  | { status: 'error'; chats: null; error: string };
