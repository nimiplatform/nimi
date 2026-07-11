import { useState } from 'react';
import type { Realm } from '@nimiplatform/sdk/realm';
import {
  listNimiRealmGroupChats,
  loadNimiRealmCreatorEligibility,
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
  requestNimiRealmDataExport,
  toNimiRealmNotificationListView,
} from '@nimiplatform/sdk/realm';
import { getNimiNotificationServerFilter } from '@nimiplatform/kit/core/notifications';
import { createRealmChatService, listRealmChats } from '@nimiplatform/kit/features/chat/realm';
import { getRuntimePlatformProjection } from '../auth/runtime-platform.js';
import type {
  AccountDataProjectionState,
  AccountSettingsProjectionState,
  GroupChatProjectionState,
  HumanChatProjectionState,
  NotificationListProjectionState,
  NotificationProjectionState,
} from './settings/types.js';
import { SettingsRouteView } from './settings/view.js';

async function requireTesterRealm(): Promise<Realm> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  throw new Error('Realm is not admitted for this app-host authorization.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Settings projection unavailable');
}

export function SettingsRoute() {
  const [localDrafts, setLocalDrafts] = useState(true);
  const [notificationProjection, setNotificationProjection] = useState<NotificationProjectionState>({ status: 'idle', unread: null, error: null });
  const [notificationListProjection, setNotificationListProjection] = useState<NotificationListProjectionState>({ status: 'idle', list: null, error: null });
  const [accountDataProjection, setAccountDataProjection] = useState<AccountDataProjectionState>({ status: 'idle', exportRequest: null, error: null });
  const [accountSettingsProjection, setAccountSettingsProjection] = useState<AccountSettingsProjectionState>({ status: 'idle', eligibility: null, error: null });
  const [humanChatProjection, setHumanChatProjection] = useState<HumanChatProjectionState>({ status: 'idle', chats: null, error: null });
  const [groupChatProjection, setGroupChatProjection] = useState<GroupChatProjectionState>({ status: 'idle', groups: null, error: null });

  const refreshNotificationProjection = async () => {
    setNotificationProjection((current) => ({ status: 'loading', unread: current.unread, error: null }));
    try {
      const unread = await loadNimiRealmNotificationUnreadCount(await requireTesterRealm());
      setNotificationProjection({ status: 'ready', unread, error: null });
    } catch (error) {
      setNotificationProjection({ status: 'error', unread: null, error: errorMessage(error) });
    }
  };

  const refreshNotificationListProjection = async () => {
    setNotificationListProjection((current) => ({ status: 'loading', list: current.list, error: null }));
    try {
      const list = await loadNimiRealmNotifications(await requireTesterRealm(), {
        limit: 5,
        unreadOnly: false,
        type: getNimiNotificationServerFilter('system') ?? undefined,
      });
      setNotificationListProjection({
        status: 'ready',
        list: toNimiRealmNotificationListView(list, 'Tester notification', 'Unknown actor'),
        error: null,
      });
    } catch (error) {
      setNotificationListProjection({ status: 'error', list: null, error: errorMessage(error) });
    }
  };

  const requestAccountDataExportProjection = async () => {
    setAccountDataProjection((current) => ({ status: 'loading', exportRequest: current.exportRequest, error: null }));
    try {
      const exportRequest = await requestNimiRealmDataExport(await requireTesterRealm(), {
        format: 'JSON',
        includeMedia: false,
        includeMessages: false,
        locale: 'en-US',
      });
      setAccountDataProjection({ status: 'ready', exportRequest, error: null });
    } catch (error) {
      setAccountDataProjection({ status: 'error', exportRequest: null, error: errorMessage(error) });
    }
  };

  const refreshAccountSettingsProjection = async () => {
    setAccountSettingsProjection((current) => ({ status: 'loading', eligibility: current.eligibility, error: null }));
    try {
      const eligibility = await loadNimiRealmCreatorEligibility(await requireTesterRealm());
      setAccountSettingsProjection({ status: 'ready', eligibility, error: null });
    } catch (error) {
      setAccountSettingsProjection({ status: 'error', eligibility: null, error: errorMessage(error) });
    }
  };

  const refreshHumanChatProjection = async () => {
    setHumanChatProjection((current) => ({ status: 'loading', chats: current.chats, error: null }));
    try {
      const realm = await requireTesterRealm();
      const chats = await listRealmChats(20, undefined, createRealmChatService(realm.humanChats));
      setHumanChatProjection({ status: 'ready', chats, error: null });
    } catch (error) {
      setHumanChatProjection({ status: 'error', chats: null, error: errorMessage(error) });
    }
  };

  const refreshGroupChatProjection = async () => {
    setGroupChatProjection((current) => ({ status: 'loading', groups: current.groups, error: null }));
    try {
      const groups = await listNimiRealmGroupChats(await requireTesterRealm(), 20);
      setGroupChatProjection({ status: 'ready', groups, error: null });
    } catch (error) {
      setGroupChatProjection({ status: 'error', groups: null, error: errorMessage(error) });
    }
  };

  return (
    <SettingsRouteView
      localDrafts={localDrafts}
      setLocalDrafts={setLocalDrafts}
      notificationProjection={notificationProjection}
      refreshNotificationProjection={refreshNotificationProjection}
      notificationListProjection={notificationListProjection}
      refreshNotificationListProjection={refreshNotificationListProjection}
      accountDataProjection={accountDataProjection}
      requestAccountDataExportProjection={requestAccountDataExportProjection}
      accountSettingsProjection={accountSettingsProjection}
      refreshAccountSettingsProjection={refreshAccountSettingsProjection}
      humanChatProjection={humanChatProjection}
      refreshHumanChatProjection={refreshHumanChatProjection}
      groupChatProjection={groupChatProjection}
      refreshGroupChatProjection={refreshGroupChatProjection}
    />
  );
}
