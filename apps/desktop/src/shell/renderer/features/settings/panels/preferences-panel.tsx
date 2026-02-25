import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { UpdateUserNotificationSettingsDto } from '@nimiplatform/sdk-realm/models/UpdateUserNotificationSettingsDto';
import type { UserNotificationSettingsDto } from '@nimiplatform/sdk-realm/models/UserNotificationSettingsDto';
import {
  PageShell,
  SaveFooter,
  SectionTitle,
} from '../settings-layout-components';
import {
  loadStoredPerformancePreferences,
  persistStoredPerformancePreferences,
  type PerformancePreferences,
} from '../settings-storage';

// Types
interface SettingRowProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

// Components
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-mint-500' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function SettingRow({ icon, title, description, checked, onChange }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
      <div className="flex items-center gap-4">
        {icon && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${checked ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'}`}>
            {icon}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}


type NotificationForm = {
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

const DEFAULT_NOTIFICATION_FORM: NotificationForm = {
  directMessages: true,
  friendRequests: true,
  mentions: true,
  likes: true,
  giftReceived: true,
  giftActionRequired: true,
  inApp: true,
  push: true,
  email: false,
};

function toNotificationForm(input: UserNotificationSettingsDto | null | undefined): NotificationForm {
  const activity = input?.activity;
  const channels = input?.channels;
  const gifts = input?.gifts;
  return {
    directMessages: activity?.directMessages !== false,
    friendRequests: activity?.friendRequests !== false,
    mentions: activity?.mentions !== false,
    likes: activity?.likes !== false,
    giftReceived: gifts?.received !== false,
    giftActionRequired: gifts?.actionRequired !== false,
    inApp: channels?.inApp !== false,
    push: channels?.push !== false,
    email: channels?.email === true,
  };
}

function toNotificationPayload(form: NotificationForm): UpdateUserNotificationSettingsDto {
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
      received: form.giftReceived,
      actionRequired: form.giftActionRequired,
    },
  };
}

function notificationsEqual(left: NotificationForm, right: NotificationForm): boolean {
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

function performanceEqual(left: PerformancePreferences, right: PerformancePreferences): boolean {
  return (
    left.hardwareAcceleration === right.hardwareAcceleration
    && left.reduceAnimations === right.reduceAnimations
    && left.autoUpdate === right.autoUpdate
    && left.developerMode === right.developerMode
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

  const hasChanges = useMemo(() => !notificationsEqual(form, baseline), [form, baseline]);

  const handleSave = async () => {
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
      setStatusBanner({
        kind: 'success',
        message: t('Notifications.updateSuccess'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('Notifications.updateError')),
      });
    } finally {
      setSaving(false);
    }
  };

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
      footer={<SaveFooter onSave={() => { void handleSave(); }} saving={saving} />}
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

// Info Card Component
function InfoCard({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        {icon && <span className="text-gray-400">{icon}</span>}
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

// Icons
function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function MailIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function UserPlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function AtSignIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function HeartIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12" />
      <path d="M12 8v12" />
    </svg>
  );
}

function AlertCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function MonitorIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function GpuIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

function AnimationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CodeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ServerIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function CpuIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function TargetIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function AwardIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="7" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  );
}

export function PerformancePage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const runtimeFields = useAppStore((s) => s.runtimeFields);
  const [preferences, setPreferences] = useState<PerformancePreferences>(() =>
    loadStoredPerformancePreferences());
  const [baseline, setBaseline] = useState<PerformancePreferences>(() =>
    loadStoredPerformancePreferences());
  const [saving, setSaving] = useState(false);

  const eligibilityQuery = useQuery({
    queryKey: ['settings-creator-eligibility'],
    queryFn: async () => dataSync.loadMyCreatorEligibility(),
  });

  const hasChanges = useMemo(() => !performanceEqual(preferences, baseline), [preferences, baseline]);

  const handleSave = async () => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setStatusBanner({
          kind: 'info',
          message: t('Performance.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      persistStoredPerformancePreferences(preferences);
      setBaseline(preferences);
      setStatusBanner({
        kind: 'success',
        message: t('Performance.saveSuccess'),
      });
    } finally {
      setSaving(false);
    }
  };

  const eligibility = eligibilityQuery.data;
  const eligibilityText = eligibilityQuery.isPending
    ? t('Performance.loadingEligibility')
    : eligibilityQuery.isError
      ? t('Performance.eligibilityLoadError')
      : eligibility
        ? `${eligibility.tier} · ${eligibility.status}`
        : '-';
  const isEligible = eligibility?.isEligible ?? false;

  return (
    <PageShell
      title={t('Performance.pageTitle')}
      description={t('Performance.pageDescription')}
      footer={<SaveFooter onSave={() => { void handleSave(); }} saving={saving} />}
    >
      {/* Rendering Settings */}
      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionRenderingDescription')}>
          {t('Performance.sectionRendering')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<GpuIcon className="h-5 w-5" />}
            title={t('Performance.hardwareAcceleration')}
            description={t('Performance.hardwareAccelerationDescription')}
            checked={preferences.hardwareAcceleration}
            onChange={(value) => setPreferences((previous) => ({ ...previous, hardwareAcceleration: value }))}
          />
          <div className="h-px bg-gray-50 mx-5" />
          <SettingRow
            icon={<AnimationIcon className="h-5 w-5" />}
            title={t('Performance.reduceAnimations')}
            description={t('Performance.reduceAnimationsDescription')}
            checked={preferences.reduceAnimations}
            onChange={(value) => setPreferences((previous) => ({ ...previous, reduceAnimations: value }))}
          />
        </div>
      </section>

      {/* Updates Settings */}
      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionUpdatesDescription')}>
          {t('Performance.sectionUpdates')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<DownloadIcon className="h-5 w-5" />}
            title={t('Performance.autoUpdate')}
            description={t('Performance.autoUpdateDescription')}
            checked={preferences.autoUpdate}
            onChange={(value) => setPreferences((previous) => ({ ...previous, autoUpdate: value }))}
          />
        </div>
      </section>

      {/* Developer Settings */}
      <section className="mt-8">
        <SectionTitle description={t('Performance.sectionDeveloperDescription')}>
          {t('Performance.sectionDeveloper')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <SettingRow
            icon={<CodeIcon className="h-5 w-5" />}
            title={t('Performance.developerMode')}
            description={t('Performance.developerModeDescription')}
            checked={preferences.developerMode}
            onChange={(value) => setPreferences((previous) => ({ ...previous, developerMode: value }))}
          />
        </div>
      </section>

      {/* Runtime Information */}
      <section className="mt-8">
        <SectionTitle>{t('Performance.sectionRuntimeInfo')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="divide-y divide-gray-50">
            <InfoCard
              icon={<ServerIcon className="h-5 w-5" />}
              label={t('Performance.provider')}
              value={runtimeFields.provider || t('Performance.notConfigured')}
            />
            <InfoCard
              icon={<CpuIcon className="h-5 w-5" />}
              label={t('Performance.model')}
              value={runtimeFields.localProviderModel || '-'}
            />
            <InfoCard
              icon={<TargetIcon className="h-5 w-5" />}
              label={t('Performance.mode')}
              value={runtimeFields.mode}
            />
            <InfoCard
              icon={<CodeIcon className="h-5 w-5" />}
              label={t('Performance.targetType')}
              value={runtimeFields.targetType}
            />
          </div>
        </div>
      </section>

      {/* Creator Eligibility */}
      <section className="mt-8">
        <SectionTitle>{t('Performance.sectionCreatorEligibility')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isEligible ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'}`}>
                <AwardIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{t('Performance.eligibility')}</p>
                <p className="text-xs text-gray-500">{eligibilityText}</p>
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${
              isEligible 
                ? 'bg-green-100 text-green-700' 
                : 'bg-amber-100 text-amber-700'
            }`}>
              {isEligible ? t('Performance.eligible') : t('Performance.notEligible')}
            </span>
          </div>
          {eligibility?.message ? (
            <p className="mt-4 text-xs text-gray-500">{eligibility.message}</p>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}
