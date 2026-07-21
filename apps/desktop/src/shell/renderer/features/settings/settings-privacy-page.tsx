import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  loadNimiRealmUserSettings,
  updateNimiRealmUserSettings,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useQuery } from '@tanstack/react-query';
import { FormFeedback, PageShell, SectionTitle } from './settings-layout-components.js';
import {
  EyeIcon,
  GlobeIcon,
  InfoIcon,
  MailIcon,
  SegmentedControl,
  ShieldIcon,
  UserIcon,
  ZapIcon,
} from './settings-privacy-controls.js';

type UpdateUserSettingsDto = RealmModel<'UpdateUserSettingsDto'>;
type UserSettingsDto = RealmModel<'UserSettingsDto'>;
type Visibility = RealmModel<'Visibility'>;

type VisibilityValue = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
type VisibilityMode = 'OPEN' | 'SMARTER_FILTER' | 'STRICT';

// Mode presets
type ModePresets = Record<VisibilityMode, PrivacyForm>;

const MODE_PRESETS: ModePresets = {
  OPEN: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'PUBLIC',
    socialVisibility: 'FRIENDS',
    onlineStatusVisibility: 'PUBLIC',
    defaultPostVisibility: 'PUBLIC',
    dmVisibility: 'PUBLIC',
  },
  SMARTER_FILTER: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'FRIENDS',
    socialVisibility: 'FRIENDS',
    onlineStatusVisibility: 'FRIENDS',
    defaultPostVisibility: 'FRIENDS',
    dmVisibility: 'FRIENDS',
  },
  STRICT: {
    profileVisibility: 'FRIENDS',
    friendRequestVisibility: 'FRIENDS',
    socialVisibility: 'PRIVATE',
    onlineStatusVisibility: 'PRIVATE',
    defaultPostVisibility: 'FRIENDS',
    dmVisibility: 'FRIENDS',
  },
};

type PrivacyForm = {
  profileVisibility: VisibilityValue;
  friendRequestVisibility: VisibilityValue;
  socialVisibility: VisibilityValue;
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
  const bindings = useDesktopRendererBindings();
  const [form, setForm] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [baseline, setBaseline] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'info' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);
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
    queryFn: async () => loadNimiRealmUserSettings(bindings.sdk.realm()),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const next = toPrivacyForm(settingsQuery.data);
    setForm(next);
    setBaseline(next);
  }, [settingsQuery.data]);

  useEffect(() => () => {
    autosaveTimerRef.current?.();
    autosaveTimerRef.current = null;
  }, []);

  const hasChanges = useMemo(() => !formsEqual(form, baseline), [form, baseline]);

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || !hasChanges) {
      if (!hasChanges) {
        setFeedback({
          kind: 'info',
          message: t('PrivacySettings.noChanges'),
        });
      }
      return;
    }
    setSaving(true);
    try {
      await updateNimiRealmUserSettings(bindings.sdk.realm(), toUpdatePayload(form));
      await settingsQuery.refetch();
      if (!silentSuccess) {
        setFeedback({
          kind: 'success',
          message: t('PrivacySettings.updateSuccess'),
        });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('PrivacySettings.updateError')),
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
        setFeedback({ kind: 'error', message: result.error });
        return;
      }
      void handleSave({ silentSuccess: true });
    });

    return () => {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
    };
  }, [bindings.clock, form, hasChanges, saving, settingsQuery.isError, settingsQuery.isPending]);

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
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('PrivacySettings.pageTitle')} />
      {/* Visibility Section */}
      <section>
        <SectionTitle description={t('PrivacySettings.visibilitySectionDescription')}>
          {t('PrivacySettings.visibilitySectionTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
                      ? 'bg-white text-gray-900 shadow-sm'
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
            <div className="h-px bg-gray-100" />
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
            <div className="h-px bg-gray-100" />
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
            <div className="h-px bg-gray-100" />
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
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
            <div className="h-px bg-gray-100" />
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

      {/* Defaults Info Card */}
      <section className="mt-8">
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.045)]">
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
