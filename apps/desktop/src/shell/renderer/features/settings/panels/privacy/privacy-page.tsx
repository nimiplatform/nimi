import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { UpdateUserSettingsDto } from '@nimiplatform/sdk-realm/models/UpdateUserSettingsDto';
import type { UserSettingsDto } from '@nimiplatform/sdk-realm/models/UserSettingsDto';
import type { Visibility } from '@nimiplatform/sdk-realm/models/Visibility';
import { PageShell, SaveFooter, SectionTitle } from '../../settings-layout-components';

type VisibilityValue = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
type VisibilityMode = 'OPEN' | 'SMARTER_FILTER' | 'STRICT';

// Mode presets
type ModePresets = Record<VisibilityMode, PrivacyForm>;

const MODE_PRESETS: ModePresets = {
  OPEN: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'PUBLIC',
    socialVisibility: 'FRIENDS',
    friendListVisibility: 'PRIVATE',
    onlineStatusVisibility: 'PUBLIC',
    defaultPostVisibility: 'PUBLIC',
    dmVisibility: 'PUBLIC',
  },
  SMARTER_FILTER: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'FRIENDS',
    socialVisibility: 'FRIENDS',
    friendListVisibility: 'PRIVATE',
    onlineStatusVisibility: 'FRIENDS',
    defaultPostVisibility: 'FRIENDS',
    dmVisibility: 'FRIENDS',
  },
  STRICT: {
    profileVisibility: 'FRIENDS',
    friendRequestVisibility: 'FRIENDS',
    socialVisibility: 'PRIVATE',
    friendListVisibility: 'PRIVATE',
    onlineStatusVisibility: 'PRIVATE',
    defaultPostVisibility: 'FRIENDS',
    dmVisibility: 'FRIENDS',
  },
};

type PrivacyForm = {
  profileVisibility: VisibilityValue;
  friendRequestVisibility: VisibilityValue;
  socialVisibility: VisibilityValue;
  friendListVisibility: VisibilityValue;
  onlineStatusVisibility: VisibilityValue;
  defaultPostVisibility: VisibilityValue;
  dmVisibility: VisibilityValue;
};

const DEFAULT_FORM: PrivacyForm = { ...MODE_PRESETS.OPEN };

function normalizeVisibility(value: unknown, fallback: VisibilityValue): VisibilityValue {
  if (value === 'PUBLIC' || value === 'FRIENDS' || value === 'PRIVATE') {
    return value;
  }
  return fallback;
}

function toPrivacyForm(settings: UserSettingsDto | null | undefined): PrivacyForm {
  if (!settings || typeof settings !== 'object') {
    return { ...DEFAULT_FORM };
  }
  return {
    profileVisibility: normalizeVisibility(settings.profileVisibility, DEFAULT_FORM.profileVisibility),
    friendRequestVisibility: normalizeVisibility(
      settings.friendRequestVisibility,
      DEFAULT_FORM.friendRequestVisibility,
    ),
    socialVisibility: normalizeVisibility(settings.socialVisibility, DEFAULT_FORM.socialVisibility),
    friendListVisibility: normalizeVisibility(
      settings.friendListVisibility,
      DEFAULT_FORM.friendListVisibility,
    ),
    onlineStatusVisibility: normalizeVisibility(
      settings.onlineStatusVisibility,
      DEFAULT_FORM.onlineStatusVisibility,
    ),
    defaultPostVisibility: normalizeVisibility(
      settings.defaultPostVisibility,
      DEFAULT_FORM.defaultPostVisibility,
    ),
    dmVisibility: normalizeVisibility(settings.dmVisibility, DEFAULT_FORM.dmVisibility),
  };
}

function toUpdatePayload(form: PrivacyForm): UpdateUserSettingsDto {
  return {
    profileVisibility: form.profileVisibility as Visibility,
    friendRequestVisibility: form.friendRequestVisibility as Visibility,
    socialVisibility: form.socialVisibility as Visibility,
    friendListVisibility: form.friendListVisibility as Visibility,
    onlineStatusVisibility: form.onlineStatusVisibility as Visibility,
    defaultPostVisibility: form.defaultPostVisibility as Visibility,
    dmVisibility: form.dmVisibility as Visibility,
  };
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

function formsEqual(left: PrivacyForm, right: PrivacyForm): boolean {
  return (
    left.profileVisibility === right.profileVisibility
    && left.friendRequestVisibility === right.friendRequestVisibility
    && left.socialVisibility === right.socialVisibility
    && left.friendListVisibility === right.friendListVisibility
    && left.onlineStatusVisibility === right.onlineStatusVisibility
    && left.defaultPostVisibility === right.defaultPostVisibility
    && left.dmVisibility === right.dmVisibility
  );
}

// Get current mode from form settings
function getCurrentMode(form: PrivacyForm): VisibilityMode | 'CUSTOM' {
  for (const [mode, preset] of Object.entries(MODE_PRESETS)) {
    if (formsEqual(form, preset)) {
      return mode as VisibilityMode;
    }
  }
  return 'CUSTOM';
}

export function PrivacyPage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [form, setForm] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [baseline, setBaseline] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const visibilitySelectOptions = useMemo(() => ([
    { value: 'PUBLIC', label: t('PrivacySettings.visibilityPublic') },
    { value: 'FRIENDS', label: t('PrivacySettings.visibilityFriends') },
    { value: 'PRIVATE', label: t('PrivacySettings.visibilityPrivate') },
  ]), [t]);

  const modeOptions = useMemo(() => [
    { value: 'OPEN', label: 'Open' },
    { value: 'SMARTER_FILTER', label: 'Smarter Filter' },
    { value: 'STRICT', label: 'Strict' },
  ], []);

  const currentMode = useMemo(() => getCurrentMode(form), [form]);

  const handleModeChange = (mode: VisibilityMode) => {
    setForm((previous) => ({
      ...previous,
      ...MODE_PRESETS[mode],
    }));
  };

  const settingsQuery = useQuery({
    queryKey: ['settings-privacy'],
    queryFn: async () => dataSync.loadMySettings(),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const next = toPrivacyForm(settingsQuery.data);
    setForm(next);
    setBaseline(next);
  }, [settingsQuery.data]);

  const hasChanges = useMemo(() => !formsEqual(form, baseline), [form, baseline]);

  const handleSave = async () => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setStatusBanner({
          kind: 'info',
          message: t('PrivacySettings.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      await dataSync.updateMySettings(toUpdatePayload(form));
      await settingsQuery.refetch();
      setStatusBanner({
        kind: 'success',
        message: t('PrivacySettings.updateSuccess'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('PrivacySettings.updateError')),
      });
    } finally {
      setSaving(false);
    }
  };

  if (settingsQuery.isPending) {
    return (
      <PageShell
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <EyeIcon className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">{t('PrivacySettings.loading')}</p>
        </div>
      </PageShell>
    );
  }

  if (settingsQuery.isError) {
    return (
      <PageShell
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {t('PrivacySettings.loadError')}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t('PrivacySettings.pageTitle')}
      description={t('PrivacySettings.pageDescription')}
      footer={<SaveFooter onSave={() => { void handleSave(); }} saving={saving} />}
    >
      {/* Visibility Section */}
      <section>
        <SectionTitle description={t('PrivacySettings.visibilitySectionDescription')}>
          {t('PrivacySettings.visibilitySectionTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          {/* Visibility Mode Master Control */}
          <div className="mb-6 rounded-xl bg-gradient-to-r from-mint-50 to-mint-100/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-mint-600 shadow-sm">
                  <ShieldIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t('PrivacySettings.visibilityModeTitle')}</p>
                  <p className="text-xs text-gray-500">{t('PrivacySettings.visibilityModeDescription')}</p>
                </div>
              </div>
            </div>
            <div className="mt-3 flex rounded-xl bg-white p-1 shadow-sm">
              {modeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleModeChange(option.value as VisibilityMode)}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                    currentMode === option.value
                      ? 'bg-mint-500 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {currentMode === 'CUSTOM' && (
              <p className="mt-2 text-xs text-amber-600">{t('PrivacySettings.customModeHint')}</p>
            )}
          </div>
          <div className="h-px bg-gray-100 mb-6" />
          <div className="space-y-5">
            <SegmentedControl
              label={t('PrivacySettings.profileVisibilityLabel')}
              value={form.profileVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                profileVisibility: normalizeVisibility(value, previous.profileVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.profileVisibilityHelper')}
            />
            <div className="h-px bg-gray-50" />
            <SegmentedControl
              label={t('PrivacySettings.friendRequestVisibilityLabel')}
              value={form.friendRequestVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                friendRequestVisibility: normalizeVisibility(value, previous.friendRequestVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.friendRequestVisibilityHelper')}
            />
            <div className="h-px bg-gray-50" />
            <SegmentedControl
              label={t('PrivacySettings.socialVisibilityLabel')}
              value={form.socialVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                socialVisibility: normalizeVisibility(value, previous.socialVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.socialVisibilityHelper')}
            />
            <div className="h-px bg-gray-50" />
            <SegmentedControl
              label={t('PrivacySettings.friendListVisibilityLabel')}
              value={form.friendListVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                friendListVisibility: normalizeVisibility(value, previous.friendListVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.friendListVisibilityHelper')}
            />
            <div className="h-px bg-gray-50" />
            <SegmentedControl
              label={t('PrivacySettings.onlineStatusVisibilityLabel')}
              value={form.onlineStatusVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                onlineStatusVisibility: normalizeVisibility(value, previous.onlineStatusVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.onlineStatusVisibilityHelper')}
            />
          </div>
        </div>
      </section>

      {/* Messaging & Post Section */}
      <section className="mt-8">
        <SectionTitle description={t('PrivacySettings.messagingSectionDescription')}>
          {t('PrivacySettings.messagingSectionTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <SegmentedControl
              label={t('PrivacySettings.defaultPostVisibilityLabel')}
              value={form.defaultPostVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                defaultPostVisibility: normalizeVisibility(value, previous.defaultPostVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.defaultPostVisibilityHelper')}
            />
            <div className="h-px bg-gray-50" />
            <SegmentedControl
              label={t('PrivacySettings.directMessageVisibilityLabel')}
              value={form.dmVisibility}
              onChange={(value) => setForm((previous) => ({
                ...previous,
                dmVisibility: normalizeVisibility(value, previous.dmVisibility),
              }))}
              options={visibilitySelectOptions}
              helper={t('PrivacySettings.directMessageVisibilityHelper')}
            />
          </div>
        </div>
      </section>

      {/* SSOT Defaults Info Card */}
      <section className="mt-8">
        <div className="rounded-2xl border border-mint-100 bg-mint-50/50 p-5">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              <InfoIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">{t('PrivacySettings.ssotDefaultsTitle')}</p>
              <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                {t('PrivacySettings.ssotDefaultsDescription')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
                  <GlobeIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagProfile')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
                  <UserIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagRequests')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
                  <ZapIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagSocial')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
                  <MailIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagDirectMessage')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

// Segmented Control Component
function SegmentedControl({
  label,
  value,
  onChange,
  options,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  helper?: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-900">{label}</label>
      <div className="flex rounded-xl bg-gray-100 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              value === option.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {helper && <p className="text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

// Icons
function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
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

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ZapIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function MailIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

