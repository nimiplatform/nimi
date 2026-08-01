import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  loadNimiRealmUserSettings,
  updateNimiRealmUserSettings,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useQuery } from '@tanstack/react-query';
import { InlineAlert, NimiText, SegmentedControl } from '@nimiplatform/kit/ui';
import {
  Card,
  FormFeedback,
  PageShell,
  Section,
  SettingRow,
  StatusBadge,
} from './settings-layout-components.js';
import {
  GlobeIcon,
  InfoIcon,
  MailIcon,
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function PrivacyPage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [form, setForm] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [baseline, setBaseline] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'error';
    message: string;
  } | null>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);
  // Edit-version race guard: every user edit bumps editVersionRef; a save
  // snapshots it on start. When the save+refetch resolves, the server-data
  // effect only resets form/baseline when the counter still equals the
  // snapshot — otherwise newer local edits win and only the baseline moves.
  const editVersionRef = useRef(0);
  const saveStartVersionRef = useRef<number | null>(null);

  const saving = saveState === 'saving';

  const visibilitySelectOptions = useMemo(() => ([
    { value: 'PUBLIC', label: t('PrivacySettings.visibilityPublic') },
    { value: 'FRIENDS', label: t('PrivacySettings.visibilityFriends') },
    { value: 'PRIVATE', label: t('PrivacySettings.visibilityPrivate') },
  ]), [t]);

  const modeOptions = useMemo(() => ([
    { value: 'OPEN', label: t('PrivacySettings.modeOpen') },
    { value: 'SMARTER_FILTER', label: t('PrivacySettings.modeSmarterFilter') },
    { value: 'STRICT', label: t('PrivacySettings.modeStrict') },
  ]), [t]);

  const currentMode = useMemo(() => getCurrentMode(form), [form]);

  const applyUserEdit = (patch: Partial<PrivacyForm>) => {
    editVersionRef.current += 1;
    setSaveState('idle');
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const handleModeChange = (mode: VisibilityMode) => {
    applyUserEdit({ ...MODE_PRESETS[mode] });
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
    const saveStartVersion = saveStartVersionRef.current;
    if (saveStartVersion !== null && editVersionRef.current !== saveStartVersion) {
      // A save+refetch resolved while the user kept editing: newer local edits
      // win, so the form is left untouched and only the baseline adopts the
      // persisted server data.
      setBaseline(next);
      return;
    }
    setForm(next);
    setBaseline(next);
  }, [settingsQuery.data]);

  useEffect(() => () => {
    autosaveTimerRef.current?.();
    autosaveTimerRef.current = null;
  }, []);

  const hasChanges = useMemo(() => !formsEqual(form, baseline), [form, baseline]);

  const handleSave = async () => {
    if (saving || !hasChanges) {
      return;
    }
    const persistedForm = form;
    saveStartVersionRef.current = editVersionRef.current;
    setSaveState('saving');
    setFeedback(null);
    try {
      await updateNimiRealmUserSettings(bindings.sdk.realm(), toUpdatePayload(persistedForm));
      await settingsQuery.refetch();
      // The baseline must reflect exactly what was persisted, even when the
      // refetch returns deep-equal data and the server-data effect above does
      // not re-run.
      setBaseline(persistedForm);
      setSaveState('saved');
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('PrivacySettings.updateError')),
      });
      setSaveState('error');
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
      void handleSave();
    });

    return () => {
      autosaveTimerRef.current?.();
      autosaveTimerRef.current = null;
    };
  }, [bindings.clock, form, hasChanges, saving, settingsQuery.isError, settingsQuery.isPending]);

  const saveStatus = saveState === 'saving'
    ? <StatusBadge status="info" text={t('Settings.statusSaving')} />
    : saveState === 'saved'
      ? <StatusBadge status="success" text={t('Settings.statusSaved')} />
      : saveState === 'error'
        ? <StatusBadge status="error" text={t('Settings.statusFailed')} />
        : null;

  if (settingsQuery.isPending) {
    return (
      <PageShell
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <NimiText role="body" className="px-1 py-6 text-center">
          {t('PrivacySettings.loading')}
        </NimiText>
      </PageShell>
    );
  }

  if (settingsQuery.isError) {
    return (
      <PageShell
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <InlineAlert tone="danger">{t('PrivacySettings.loadError')}</InlineAlert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t('PrivacySettings.pageTitle')}
      description={t('PrivacySettings.pageDescription')}
      status={saveStatus}
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('PrivacySettings.pageTitle')} />
      {/* Visibility Section */}
      <Section
        title={t('PrivacySettings.visibilitySectionTitle')}
        description={t('PrivacySettings.visibilitySectionDescription')}
      >
        <Card>
          {/* Visibility Mode Master Control */}
          <div className="flex flex-col gap-2">
            <div>
              <NimiText role="card-title">{t('PrivacySettings.visibilityModeTitle')}</NimiText>
              <NimiText role="helper" className="mt-0.5">
                {t('PrivacySettings.visibilityModeDescription')}
              </NimiText>
            </div>
            <div>
              <SegmentedControl
                items={modeOptions}
                value={currentMode === 'CUSTOM' ? '' : currentMode}
                onValueChange={(value) => handleModeChange(value as VisibilityMode)}
                ariaLabel={t('PrivacySettings.visibilityModeTitle')}
              />
            </div>
            {currentMode === 'CUSTOM' ? (
              <NimiText role="caption">{t('PrivacySettings.customModeHint')}</NimiText>
            ) : null}
          </div>
          <div className="my-2 h-px bg-[var(--nimi-border-subtle)]" />
          <div className="divide-y divide-[color:var(--nimi-border-subtle)]">
            <SettingRow
              title={t('PrivacySettings.profileVisibilityLabel')}
              description={t('PrivacySettings.profileVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.profileVisibility}
                  onValueChange={(value) => applyUserEdit({
                    profileVisibility: normalizeVisibility(value, form.profileVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.profileVisibilityLabel')}
                  size="sm"
                />
              )}
            />
            <SettingRow
              title={t('PrivacySettings.friendRequestVisibilityLabel')}
              description={t('PrivacySettings.friendRequestVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.friendRequestVisibility}
                  onValueChange={(value) => applyUserEdit({
                    friendRequestVisibility: normalizeVisibility(value, form.friendRequestVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.friendRequestVisibilityLabel')}
                  size="sm"
                />
              )}
            />
            <SettingRow
              title={t('PrivacySettings.socialVisibilityLabel')}
              description={t('PrivacySettings.socialVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.socialVisibility}
                  onValueChange={(value) => applyUserEdit({
                    socialVisibility: normalizeVisibility(value, form.socialVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.socialVisibilityLabel')}
                  size="sm"
                />
              )}
            />
            <SettingRow
              title={t('PrivacySettings.onlineStatusVisibilityLabel')}
              description={t('PrivacySettings.onlineStatusVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.onlineStatusVisibility}
                  onValueChange={(value) => applyUserEdit({
                    onlineStatusVisibility: normalizeVisibility(value, form.onlineStatusVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.onlineStatusVisibilityLabel')}
                  size="sm"
                />
              )}
            />
          </div>
        </Card>
      </Section>

      {/* Messaging & Post Section */}
      <Section
        title={t('PrivacySettings.messagingSectionTitle')}
        description={t('PrivacySettings.messagingSectionDescription')}
      >
        <Card>
          <div className="divide-y divide-[color:var(--nimi-border-subtle)]">
            <SettingRow
              title={t('PrivacySettings.defaultPostVisibilityLabel')}
              description={t('PrivacySettings.defaultPostVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.defaultPostVisibility}
                  onValueChange={(value) => applyUserEdit({
                    defaultPostVisibility: normalizeVisibility(value, form.defaultPostVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.defaultPostVisibilityLabel')}
                  size="sm"
                />
              )}
            />
            <SettingRow
              title={t('PrivacySettings.directMessageVisibilityLabel')}
              description={t('PrivacySettings.directMessageVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.dmVisibility}
                  onValueChange={(value) => applyUserEdit({
                    dmVisibility: normalizeVisibility(value, form.dmVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.directMessageVisibilityLabel')}
                  size="sm"
                />
              )}
            />
          </div>
        </Card>
      </Section>

      {/* Defaults Info Card */}
      <Section>
        <Card>
          <div className="flex gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] text-[var(--nimi-text-muted)]">
              <InfoIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <NimiText role="card-title">{t('PrivacySettings.ssotDefaultsTitle')}</NimiText>
              <NimiText role="helper" className="mt-1">
                {t('PrivacySettings.ssotDefaultsDescription')}
              </NimiText>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                  <GlobeIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagProfile')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                  <UserIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagRequests')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                  <ZapIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagSocial')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                  <MailIcon className="h-3.5 w-3.5" />
                  {t('PrivacySettings.tagDirectMessage')}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </Section>
    </PageShell>
  );
}
