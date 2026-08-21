import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  loadNimiRealmUserNotificationSettings,
  updateNimiRealmUserNotificationSettings,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useQuery } from '@tanstack/react-query';
import { NimiText } from '@nimiplatform/kit/ui';
import {
  Card,
  FormFeedback,
  PageShell,
  Section,
  StatusBadge,
  ToggleRow,
} from './settings-layout-components.js';
import { InfoIcon, MailIcon, MonitorIcon } from './settings-assets.js';
import {
  AlertCircleIcon,
  AtSignIcon,
  BellIcon,
  GiftIcon,
  HeartIcon,
  UserPlusIcon,
} from './settings-preferences-panel-parts.js';

type UpdateUserNotificationSettingsDto = RealmModel<'UpdateUserNotificationSettingsDto'>;
type UserNotificationSettingsDto = RealmModel<'UserNotificationSettingsDto'>;

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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function NotificationsPage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [form, setForm] = useState<NotificationForm>({ ...DEFAULT_NOTIFICATION_FORM });
  const [baseline, setBaseline] = useState<NotificationForm>({ ...DEFAULT_NOTIFICATION_FORM });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'info' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);
  // Monotonic counter bumped on every user edit; a save snapshots it so that
  // server data landing after the save can be ignored when newer edits exist.
  const editVersionRef = useRef(0);
  const saveSnapshotRef = useRef<number | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings-notification'],
    queryFn: async () => loadNimiRealmUserNotificationSettings(bindings.sdk.realm()),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const armedSnapshot = saveSnapshotRef.current;
    if (armedSnapshot !== null) {
      if (editVersionRef.current !== armedSnapshot) {
        // Newer edits landed while this save/refetch was in flight; they win.
        return;
      }
      saveSnapshotRef.current = null;
    }
    const next = toNotificationForm(settingsQuery.data);
    setForm(next);
    setBaseline(next);
  }, [settingsQuery.data]);

  useEffect(() => () => {
    autosaveTimerRef.current?.();
    autosaveTimerRef.current = null;
  }, []);

  const hasChanges = useMemo(() => !notificationsEqual(form, baseline), [form, baseline]);

  const applyUserEdit = (patch: Partial<NotificationForm>) => {
    editVersionRef.current += 1;
    setSaveStatus('idle');
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setFeedback({
          kind: 'info',
          message: t('Notifications.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    setSaveStatus('saving');
    const saveSnapshot = editVersionRef.current;
    const savedForm = form;
    try {
      await updateNimiRealmUserNotificationSettings(bindings.sdk.realm(), toNotificationPayload(savedForm));
      saveSnapshotRef.current = saveSnapshot;
      await settingsQuery.refetch();
      if (editVersionRef.current === saveSnapshot) {
        // No newer edits arrived in flight; the saved form is the new baseline
        // even when the refetch returns structurally identical data.
        setBaseline(savedForm);
      }
      setSaveStatus('saved');
      if (!silentSuccess) {
        setFeedback({
          kind: 'success',
          message: t('Notifications.updateSuccess'),
        });
      }
    } catch (error) {
      saveSnapshotRef.current = null;
      setSaveStatus('error');
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('Notifications.updateError')),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (saving || !hasChanges || settingsQuery.isPending || settingsQuery.isError) {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
      return;
    }

    autosaveTimerRef.current?.();
    autosaveTimerRef.current = bindings.clock.schedule(700, (result) => {
      autosaveTimerRef.current = null;
      if (!result.ok) {
        setSaveStatus('error');
        setFeedback({
          kind: 'error',
          message: result.error,
        });
        return;
      }
      void handleSave({ silentSuccess: true });
    });

    return () => {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
    };
  }, [bindings.clock, form, hasChanges, saving, settingsQuery.isError, settingsQuery.isPending]);

  const statusNode = saveStatus === 'saving'
    ? <StatusBadge status="info" text={t('Settings.statusSaving')} />
    : saveStatus === 'saved'
      ? <StatusBadge status="success" text={t('Settings.statusSaved')} />
      : saveStatus === 'error'
        ? <StatusBadge status="error" text={t('Settings.statusFailed')} />
        : null;

  if (settingsQuery.isPending) {
    return (
      <PageShell title={t('Notifications.pageTitle')} description={t('Notifications.pageDescription')}>
        <Card>
          <div className="flex items-center gap-3">
            <BellIcon className="h-5 w-5 text-[var(--nimi-text-muted)]" />
            <NimiText role="body">{t('Notifications.loading')}</NimiText>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (settingsQuery.isError) {
    return (
      <PageShell title={t('Notifications.pageTitle')} description={t('Notifications.pageDescription')}>
        <FormFeedback
          feedback={{ kind: 'error', message: t('Notifications.loadError') }}
          title={t('Notifications.pageTitle')}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t('Notifications.pageTitle')}
      description={t('Notifications.pageDescription')}
      status={statusNode}
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('Notifications.pageTitle')} />
      {/* Activity Notifications */}
      <Section
        title={t('Notifications.sectionActivity')}
        description={t('Notifications.sectionActivityDescription')}
      >
        <Card>
          <ToggleRow
            icon={<MailIcon className="h-5 w-5" />}
            title={t('Notifications.directMessages')}
            description={t('Notifications.directMessagesDescription')}
            checked={form.directMessages}
            onChange={(value) => applyUserEdit({ directMessages: value })}
          />
          <ToggleRow
            icon={<UserPlusIcon className="h-5 w-5" />}
            title={t('Notifications.friendRequests')}
            description={t('Notifications.friendRequestsDescription')}
            checked={form.friendRequests}
            onChange={(value) => applyUserEdit({ friendRequests: value })}
          />
          <ToggleRow
            icon={<AtSignIcon className="h-5 w-5" />}
            title={t('Notifications.mentions')}
            description={t('Notifications.mentionsDescription')}
            checked={form.mentions}
            onChange={(value) => applyUserEdit({ mentions: value })}
          />
          <ToggleRow
            icon={<HeartIcon className="h-5 w-5" />}
            title={t('Notifications.likes')}
            description={t('Notifications.likesDescription')}
            checked={form.likes}
            onChange={(value) => applyUserEdit({ likes: value })}
          />
        </Card>
      </Section>

      {/* Gift Notifications */}
      <Section
        title={t('Notifications.sectionGifts')}
        description={t('Notifications.sectionGiftsDescription')}
      >
        <Card>
          <ToggleRow
            icon={<GiftIcon className="h-5 w-5" />}
            title={t('Notifications.giftReceived')}
            description={t('Notifications.giftReceivedDescription')}
            checked={form.giftReceived}
            onChange={(value) => applyUserEdit({ giftReceived: value })}
          />
          <ToggleRow
            icon={<AlertCircleIcon className="h-5 w-5" />}
            title={t('Notifications.giftActionRequired')}
            description={t('Notifications.giftActionRequiredDescription')}
            checked={form.giftActionRequired}
            onChange={(value) => applyUserEdit({ giftActionRequired: value })}
          />
        </Card>
      </Section>

      {/* Channel Notifications */}
      <Section
        title={t('Notifications.sectionChannels')}
        description={t('Notifications.sectionChannelsDescription')}
      >
        <Card>
          <ToggleRow
            icon={<BellIcon className="h-5 w-5" />}
            title={t('Notifications.inApp')}
            description={t('Notifications.inAppDescription')}
            checked={form.inApp}
            onChange={(value) => applyUserEdit({ inApp: value })}
          />
          <ToggleRow
            icon={<MonitorIcon className="h-5 w-5" />}
            title={t('Notifications.push')}
            description={t('Notifications.pushDescription')}
            checked={form.push}
            onChange={(value) => applyUserEdit({ push: value })}
          />
          <ToggleRow
            icon={<MailIcon className="h-5 w-5" />}
            title={t('Notifications.emailChannel')}
            description={t('Notifications.emailChannelDescription')}
            checked={form.email}
            onChange={(value) => applyUserEdit({ email: value })}
          />
        </Card>
      </Section>

      {/* SSOT Note */}
      <Card>
        <div className="flex gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] text-[var(--nimi-action-primary-bg)]">
            <InfoIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <NimiText role="card-title">{t('Notifications.ssotNoteTitle')}</NimiText>
            <NimiText role="helper" className="mt-0.5">
              {t('Notifications.ssotNoteDescription')}
            </NimiText>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
