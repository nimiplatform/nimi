import { useSettingsSaveGuard } from './use-settings-save-guard.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
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
  UserIcon,
  ZapIcon,
} from './settings-privacy-controls.js';
import { InfoIcon, MailIcon } from './settings-assets.js';

type UpdateUserSettingsDto = RealmModel<'UpdateUserSettingsDto'>;
type UserSettingsDto = RealmModel<'UserSettingsDto'>;
type VisibilityValue = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
type VisibilityMode = 'OPEN' | 'FRIENDS_ONLY' | 'STRICT';

// Mode presets
type ModePresets = Record<VisibilityMode, PrivacyForm>;

const MODE_PRESETS: ModePresets = {
  OPEN: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'PUBLIC',
    friendListVisibility: 'FRIENDS',
    onlineStatusVisibility: 'PUBLIC',
    dmVisibility: 'PUBLIC',
  },
  FRIENDS_ONLY: {
    profileVisibility: 'PUBLIC',
    friendRequestVisibility: 'PUBLIC',
    friendListVisibility: 'FRIENDS',
    onlineStatusVisibility: 'FRIENDS',
    dmVisibility: 'FRIENDS',
  },
  STRICT: {
    profileVisibility: 'FRIENDS',
    friendRequestVisibility: 'PRIVATE',
    friendListVisibility: 'PRIVATE',
    onlineStatusVisibility: 'PRIVATE',
    dmVisibility: 'FRIENDS',
  },
};

type PrivacyForm = {
  profileVisibility: VisibilityValue;
  friendRequestVisibility: 'PUBLIC' | 'PRIVATE';
  friendListVisibility: VisibilityValue;
  onlineStatusVisibility: VisibilityValue;
  dmVisibility: VisibilityValue;
};

const DEFAULT_FORM: PrivacyForm = { ...MODE_PRESETS.FRIENDS_ONLY };

function normalizeVisibility(value: unknown, fallback: VisibilityValue): VisibilityValue {
  if (value === 'PUBLIC' || value === 'FRIENDS' || value === 'PRIVATE') {
    return value;
  }
  return fallback;
}

export function toPrivacyForm(settings: UserSettingsDto): PrivacyForm {
  const visibility = (value: unknown): VisibilityValue => {
    if (value === 'PUBLIC' || value === 'FRIENDS' || value === 'PRIVATE') return value;
    throw new Error('Privacy settings are unavailable. Please reload.');
  };
  const request = settings.friendRequestVisibility;
  if (request !== 'PUBLIC' && request !== 'PRIVATE') throw new Error('Friend request settings are unavailable. Please reload.');
  return {
    profileVisibility: visibility(settings.profileVisibility),
    friendRequestVisibility: request,
    friendListVisibility: visibility(settings.friendListVisibility),
    onlineStatusVisibility: visibility(settings.onlineStatusVisibility),
    dmVisibility: visibility(settings.dmVisibility),
  };
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r018
export function toUpdatePayload(form: PrivacyForm, baseline: PrivacyForm): UpdateUserSettingsDto {
  const changed: Record<string, VisibilityValue> = {};
  for (const key of Object.keys(form) as (keyof PrivacyForm)[]) {
    if (form[key] !== baseline[key]) changed[key] = form[key];
  }
  return changed;

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
    && left.friendListVisibility === right.friendListVisibility
    && left.onlineStatusVisibility === right.onlineStatusVisibility
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
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  return <AccountPrivacyPage key={realmBaseUrl + '|' + accountId} accountId={accountId} realmBaseUrl={realmBaseUrl} />;
}

function AccountPrivacyPage({ accountId, realmBaseUrl }: { accountId: string; realmBaseUrl: string }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const activeOperation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const [form, setForm] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [baseline, setBaseline] = useState<PrivacyForm>({ ...DEFAULT_FORM });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'error';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);
  // Edit-version race guard: every user edit bumps editVersionRef; a save
  // snapshots it on start. When the save+refetch resolves, the server-data
  // effect only resets form/baseline when the counter still equals the
  // snapshot — otherwise newer local edits win and only the baseline moves.
  const editVersionRef = useRef(0);
  const saveStartVersionRef = useRef<number | null>(null);
  // A failed save pins the edit version it tried to persist. Autosave does not
  // retry that same version; an explicit retry or a new edit schedules again,
  // and the unsaved form stays in place meanwhile.
  const failedEditVersionRef = useRef<number | null>(null);

  const saving = saveState === 'saving';

  const visibilitySelectOptions = useMemo(() => ([
    { value: 'PUBLIC', label: t('PrivacySettings.visibilityPublic') },
    { value: 'FRIENDS', label: t('PrivacySettings.visibilityFriends') },
    { value: 'PRIVATE', label: t('PrivacySettings.visibilityPrivate') },
  ]), [t]);

  const modeOptions = useMemo(() => ([
    { value: 'OPEN', label: t('PrivacySettings.modeOpen') },
    { value: 'FRIENDS_ONLY', label: t('PrivacySettings.modeFriendsOnly') },
    { value: 'STRICT', label: t('PrivacySettings.modeStrict') },
  ]), [t]);

  const currentMode = useMemo(() => getCurrentMode(form), [form]);

  const applyUserEdit = (patch: Partial<PrivacyForm>) => {
    editVersionRef.current += 1;
    setSaveState('idle');
    setFeedback(null);
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const handleModeChange = (mode: VisibilityMode) => {
    applyUserEdit({ ...MODE_PRESETS[mode] });
  };

  const settingsQuery = useQuery({
    queryKey: ['settings-privacy', realmBaseUrl, accountId],
    queryFn: async () => toPrivacyForm(await loadNimiRealmUserSettings(bindings.sdk.realm())),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const next = settingsQuery.data;
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
    activeOperation.current?.dispose();
  }, []);

  const hasChanges = useMemo(() => !formsEqual(form, baseline), [form, baseline]);

  const performSave = async (isCurrent: () => boolean) => {
    if (!hasChanges) {
      return true;
    }
    const persistedForm = form;
    saveStartVersionRef.current = editVersionRef.current;
    failedEditVersionRef.current = null;
    setSaveState('saving');
    setFeedback(null);
    const scope = captureAccountActionScope(store);
    activeOperation.current = scope;
    try {
      if (!scope) throw new Error(t('Profile.accountUnavailable'));
      await updateNimiRealmUserSettings(bindings.sdk.realm(), toUpdatePayload(persistedForm, baseline));
      if (!isCurrent() || !scope.isCurrent()) return false;
      await settingsQuery.refetch();
      if (!isCurrent() || !scope.isCurrent()) return false;
      // The baseline must reflect exactly what was persisted, even when the
      // refetch returns deep-equal data and the server-data effect above does
      // not re-run.
      setBaseline(persistedForm);
      setSaveState('saved');
      return true;
    } catch (error) {
      if (scope && !scope.isCurrent()) return false;
      failedEditVersionRef.current = saveStartVersionRef.current;
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('PrivacySettings.updateError')),
        actionLabel: t('Common.retry', { defaultValue: 'Retry' }),
        onAction: () => { void handleSaveRef.current(); },
      });
      setSaveState('error');
      return false;
    } finally {
      scope?.dispose();
      if (activeOperation.current === scope) activeOperation.current = null;
    }
  };
  const { save: handleSave, dialog: leaveDialog } = useSettingsSaveGuard({
    dirty: hasChanges, revision: editVersionRef.current, currentRevision: () => editVersionRef.current,
    cancelScheduled: () => { autosaveTimerRef.current?.(); autosaveTimerRef.current = null; },
    commit: isCurrent => performSave(isCurrent),
  });


  // The retry action always saves the current form, not the failed render's.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    const failedThisEdit = saveState === 'error' && failedEditVersionRef.current === editVersionRef.current;
    if (saving || !hasChanges || failedThisEdit || settingsQuery.isPending || settingsQuery.isError) {
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
  }, [bindings.clock, form, hasChanges, saveState, saving, settingsQuery.isError, settingsQuery.isPending]);

  const saveStatus = saveState === 'saving'
    ? <StatusBadge status="info" text={t('Settings.statusSaving')} />
    : saveState === 'saved'
      ? <StatusBadge status="success" text={t('Settings.statusSaved')} />
      : saveState === 'error'
        ? <StatusBadge status="error" text={t('Settings.statusFailed')} />
        : null;

  if (settingsQuery.isPending) {
    return (
      <PageShell footer={leaveDialog}
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <Card>
          <div className="flex items-center gap-3">
            <GlobeIcon className="h-5 w-5 text-[var(--nimi-text-muted)]" />
            <NimiText role="body">{t('PrivacySettings.loading')}</NimiText>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (settingsQuery.isError) {
    return (
      <PageShell footer={leaveDialog}
        title={t('PrivacySettings.pageTitle')}
        description={t('PrivacySettings.pageDescription')}
      >
        <InlineAlert tone="danger">{t('PrivacySettings.loadError')}</InlineAlert>
        <button type="button" onClick={() => { void settingsQuery.refetch(); }} className="text-sm text-[var(--nimi-action-primary-bg)]">{t('Common.retry')}</button>
      </PageShell>
    );
  }

  return (
    <PageShell footer={leaveDialog}
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
                  items={[{ value: 'PUBLIC', label: t('PrivacySettings.requestsAllowed') }, { value: 'PRIVATE', label: t('PrivacySettings.requestsClosed') }]}
                  value={form.friendRequestVisibility}
                  onValueChange={(value) => applyUserEdit({
                    friendRequestVisibility: value === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
                  })}
                  ariaLabel={t('PrivacySettings.friendRequestVisibilityLabel')}
                  size="sm"
                />
              )}
            />
            <SettingRow
              title={t('PrivacySettings.friendListVisibilityLabel')}
              description={t('PrivacySettings.friendListVisibilityHelper')}
              control={(
                <SegmentedControl
                  items={visibilitySelectOptions}
                  value={form.friendListVisibility}
                  onValueChange={(value) => applyUserEdit({
                    friendListVisibility: normalizeVisibility(value, form.friendListVisibility),
                  })}
                  ariaLabel={t('PrivacySettings.friendListVisibilityLabel')}
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

      {/* Direct Messaging Section */}
      <Section
        title={t('PrivacySettings.messagingSectionTitle')}
        description={t('PrivacySettings.messagingSectionDescription')}
      >
        <Card>
          <div className="divide-y divide-[color:var(--nimi-border-subtle)]">
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
