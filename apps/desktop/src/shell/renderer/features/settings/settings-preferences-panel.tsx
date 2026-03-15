import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { UpdateUserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import {
  PageShell,
  SectionTitle,
} from './settings-layout-components';
import {
  AlertCircleIcon,
  AtSignIcon,
  BellIcon,
  GiftIcon,
  HeartIcon,
  InfoIcon,
  MailIcon,
  MonitorIcon,
  SettingRow,
  UserPlusIcon,
} from './settings-preferences-panel-parts';

export {
  canUseDesktopUpdater,
  collectDesktopUpdatePanelAlerts,
} from './settings-preferences-panel-parts';

export type NotificationForm = {
  directMessages: boolean;
  friendRequests: boolean;
  mentions: boolean;
  likes: boolean;
  giftReceived: boolean;
  giftActionRequired: boolean;
  inApp: boolean;
  push: boolean;
  email: boolean;
};

export const DEFAULT_NOTIFICATION_FORM: NotificationForm = {
  directMessages: true,
  friendRequests: true,
  mentions: true,
  likes: true,
  giftReceived: true,
  giftActionRequired: true,
  inApp: true,
  push: false,
  email: true,
};

function isEnabled(input: Array<boolean | null | undefined>, fallback = true): boolean {
  const definedValues = input.filter((value): value is boolean => typeof value === 'boolean');
  if (definedValues.length === 0) {
    return fallback;
  }
  return definedValues.every((value) => value === true);
}

export function toNotificationForm(input: UserNotificationSettingsDto | null | undefined): NotificationForm {
  const activity = input?.activity;
  const channels = input?.channels;
  const gifts = input?.gifts;
  return {
    directMessages: isEnabled([activity?.directMessages], DEFAULT_NOTIFICATION_FORM.directMessages),
    friendRequests: isEnabled([activity?.friendRequests], DEFAULT_NOTIFICATION_FORM.friendRequests),
    mentions: isEnabled([activity?.mentions], DEFAULT_NOTIFICATION_FORM.mentions),
    likes: isEnabled([activity?.likes], DEFAULT_NOTIFICATION_FORM.likes),
    giftReceived: isEnabled(
      [gifts?.received, gifts?.acceptedRejected],
      DEFAULT_NOTIFICATION_FORM.giftReceived,
    ),
    giftActionRequired: isEnabled(
      [gifts?.actionRequired, gifts?.refunds, gifts?.paymentFailed],
      DEFAULT_NOTIFICATION_FORM.giftActionRequired,
    ),
    inApp: isEnabled([channels?.inApp], DEFAULT_NOTIFICATION_FORM.inApp),
    push: isEnabled([channels?.push], DEFAULT_NOTIFICATION_FORM.push),
    email: isEnabled([channels?.email], DEFAULT_NOTIFICATION_FORM.email),
  };
}

export function toNotificationPayload(form: NotificationForm): UpdateUserNotificationSettingsDto {
  return {
    activity: {
      directMessages: form.directMessages,
      friendRequests: form.friendRequests,
      mentions: form.mentions,
      likes: form.likes,
    },
    channels: {
      inApp: form.inApp,
      push: form.push,
      email: form.email,
    },
    gifts: {
      acceptedRejected: form.giftReceived,
      received: form.giftReceived,
      actionRequired: form.giftActionRequired,
      paymentFailed: form.giftActionRequired,
      refunds: form.giftActionRequired,
    },
  };
}

export function notificationsEqual(left: NotificationForm, right: NotificationForm): boolean {
  return (
    left.directMessages === right.directMessages
    && left.friendRequests === right.friendRequests
    && left.mentions === right.mentions
    && left.likes === right.likes
    && left.giftReceived === right.giftReceived
    && left.giftActionRequired === right.giftActionRequired
    && left.inApp === right.inApp
    && left.push === right.push
    && left.email === right.email
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const [form, setForm] = useState<NotificationForm>({ ...DEFAULT_NOTIFICATION_FORM });
  const [baseline, setBaseline] = useState<NotificationForm>({ ...DEFAULT_NOTIFICATION_FORM });
  const [saving, setSaving] = useState(false);
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings-notification'],
    queryFn: async () => dataSync.loadMyNotificationSettings(),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const next = toNotificationForm(settingsQuery.data);
    setForm(next);
    setBaseline(next);
  }, [settingsQuery.data]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  const hasChanges = useMemo(() => !notificationsEqual(form, baseline), [form, baseline]);

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setStatusBanner({
          kind: 'info',
          message: t('Notifications.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      await dataSync.updateMyNotificationSettings(toNotificationPayload(form));
      await settingsQuery.refetch();
      if (!silentSuccess) {
        setStatusBanner({
          kind: 'success',
          message: t('Notifications.updateSuccess'),
        });
      }
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Notifications.updateError')),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges || settingsQuery.isPending || settingsQuery.isError) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void handleSave({ silentSuccess: true });
    }, 700);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [form, hasChanges, saving, settingsQuery.isError, settingsQuery.isPending]);

  if (settingsQuery.isPending) {
    return (
      <PageShell title={t('Notifications.pageTitle')} description={t('Notifications.pageDescription')}>
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <BellIcon className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">{t('Notifications.loading')}</p>
        </div>
      </PageShell>
    );
  }

  if (settingsQuery.isError) {
    return (
      <PageShell title={t('Notifications.pageTitle')} description={t('Notifications.pageDescription')}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {t('Notifications.loadError')}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t('Notifications.pageTitle')}
      description={t('Notifications.pageDescription')}
    >
      {/* Activity Notifications */}
      <section>
        <SectionTitle description={t('Notifications.sectionActivityDescription')}>
          {t('Notifications.sectionActivity')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<MailIcon className="h-5 w-5" />}
            title={t('Notifications.directMessages')}
            description={t('Notifications.directMessagesDescription')}
            checked={form.directMessages}
            onChange={(value) => setForm((previous) => ({ ...previous, directMessages: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<UserPlusIcon className="h-5 w-5" />}
            title={t('Notifications.friendRequests')}
            description={t('Notifications.friendRequestsDescription')}
            checked={form.friendRequests}
            onChange={(value) => setForm((previous) => ({ ...previous, friendRequests: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<AtSignIcon className="h-5 w-5" />}
            title={t('Notifications.mentions')}
            description={t('Notifications.mentionsDescription')}
            checked={form.mentions}
            onChange={(value) => setForm((previous) => ({ ...previous, mentions: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<HeartIcon className="h-5 w-5" />}
            title={t('Notifications.likes')}
            description={t('Notifications.likesDescription')}
            checked={form.likes}
            onChange={(value) => setForm((previous) => ({ ...previous, likes: value }))}
          />
        </div>
      </section>

      {/* Gift Notifications */}
      <section className="mt-8">
        <SectionTitle description={t('Notifications.sectionGiftsDescription')}>
          {t('Notifications.sectionGifts')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<GiftIcon className="h-5 w-5" />}
            title={t('Notifications.giftReceived')}
            description={t('Notifications.giftReceivedDescription')}
            checked={form.giftReceived}
            onChange={(value) => setForm((previous) => ({ ...previous, giftReceived: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<AlertCircleIcon className="h-5 w-5" />}
            title={t('Notifications.giftActionRequired')}
            description={t('Notifications.giftActionRequiredDescription')}
            checked={form.giftActionRequired}
            onChange={(value) => setForm((previous) => ({ ...previous, giftActionRequired: value }))}
          />
        </div>
      </section>

      {/* Channel Notifications */}
      <section className="mt-8">
        <SectionTitle description={t('Notifications.sectionChannelsDescription')}>
          {t('Notifications.sectionChannels')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<BellIcon className="h-5 w-5" />}
            title={t('Notifications.inApp')}
            description={t('Notifications.inAppDescription')}
            checked={form.inApp}
            onChange={(value) => setForm((previous) => ({ ...previous, inApp: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<MonitorIcon className="h-5 w-5" />}
            title={t('Notifications.push')}
            description={t('Notifications.pushDescription')}
            checked={form.push}
            onChange={(value) => setForm((previous) => ({ ...previous, push: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<MailIcon className="h-5 w-5" />}
            title={t('Notifications.emailChannel')}
            description={t('Notifications.emailChannelDescription')}
            checked={form.email}
            onChange={(value) => setForm((previous) => ({ ...previous, email: value }))}
          />
        </div>
      </section>

      {/* SSOT Note */}
      <section className="mt-8">
        <div className="rounded-2xl border border-mint-100 bg-mint-50/50 p-5">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              <InfoIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('Notifications.ssotNoteTitle')}</p>
              <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                {t('Notifications.ssotNoteDescription')}
              </p>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
