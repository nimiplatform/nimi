/**
 * Profiles section — canonical six-section Runtime IA.
 *
 * Profile catalog management is owned by the account profile library file
 * family. Capability binding detail and preview-gated apply
 * (D-AIPC-014 / S-AICONF-008) still use the Nimi Kit AI Config component
 * (`ModelConfigAiModelHub`). The old localStorage-backed
 * `runtime-config-profile-editor.tsx` remains retired.
 *
 * The Account Default Profile is file-backed (P-AIPS-013 `account_profile_library`);
 * the library access layer (`runtime-config-profile-library`) feeds the kit's
 * synchronous `userProfilesSource`. This section exposes:
 *   - create / edit / delete / import / export of editable library profiles
 *   - Account Default Profile as a switchable profile row
 *   - per-capability edit via the kit AI Config component
 *   - explicit factory-restore (preview-gated re-apply of the file-backed
 *     Account Default Profile to the active scope)
 *   - the "Active Default Profile for new scopes" indicator (ordinary task 2),
 *     surfaced by the kit hub via `currentOrigin`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig, AIProfile } from '@nimiplatform/sdk/mod';
import { applyAIProfileToConfig, validateAIProfile } from '@nimiplatform/sdk/mod';
import {
  CANONICAL_CAPABILITY_CATALOG,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type { AppModelConfigSurface } from '@nimiplatform/nimi-kit/features/model-config';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
} from '@nimiplatform/nimi-kit/features/model-config';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { getDesktopRouteModelPickerProvider } from './desktop-route-model-picker-provider.js';
import { useLocalAssets } from '../chat/capability-settings-shared.js';
import {
  createAccountProfileLibraryEntry,
  deleteAccountProfileLibraryEntry,
  editAccountProfileLibraryEntry,
  exportAccountProfileLibraryEntries,
  generateLibraryProfileId,
  getCachedAccountProfileLibraryProfiles,
  importAccountProfileLibraryEntries,
  loadAccountProfileLibrary,
  type AccountProfileLibraryProjection,
  type LibraryProfile,
} from './runtime-config-profile-library.js';

// Account default profile spans every canonical capability.
const RUNTIME_ENABLED_CAPABILITIES = Object.freeze(
  CANONICAL_CAPABILITY_CATALOG.map((descriptor) => descriptor.capabilityId),
);

type ProfileFeedback = { type: 'success' | 'error'; message: string } | null;

type ProfileEditorDraft = {
  mode: 'create' | 'edit';
  profile: AIProfile;
  title: string;
  description: string;
  tagsText: string;
  replaceWithCurrentConfig: boolean;
};

function profileCapabilitiesFromAIConfig(
  capabilities: AIConfig['capabilities'],
): AIProfile['capabilities'] {
  const out: AIProfile['capabilities'] = {};
  const capabilityIds = new Set([
    ...Object.keys(capabilities.selectedBindings ?? {}),
    ...Object.keys(capabilities.localProfileRefs ?? {}),
    ...Object.keys(capabilities.selectedParams ?? {}),
  ]);
  for (const capabilityId of capabilityIds) {
    out[capabilityId] = {
      binding: capabilities.selectedBindings?.[capabilityId] ?? null,
      localProfileRef: capabilities.localProfileRefs?.[capabilityId] ?? null,
      params: capabilities.selectedParams?.[capabilityId] ?? {},
    };
  }
  return out;
}

function normalizeTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function countConfiguredCapabilities(profile: AIProfile): number {
  return Object.values(profile.capabilities).filter((intent) => {
    if (!intent) return false;
    const params = intent.params && Object.keys(intent.params).length > 0;
    return Boolean(intent.binding || intent.localProfileRef || params);
  }).length;
}

function toEditableAIProfile(profile: {
  readonly profileId: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly capabilities: Record<string, unknown>;
}): AIProfile {
  return {
    profileId: profile.profileId,
    title: profile.title,
    description: profile.description,
    tags: [...profile.tags],
    capabilities: { ...profile.capabilities } as AIProfile['capabilities'],
  };
}

function ProfileEditorModal(props: {
  draft: ProfileEditorDraft;
  saving: boolean;
  onDraftChange: (draft: ProfileEditorDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 px-4">
      <section
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        data-testid="runtime-profiles-editor"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            {draft.mode === 'create'
              ? t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })
              : t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' })}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t('runtimeConfig.profiles.profileIdentityHint', {
              defaultValue: 'Set this AI profile metadata and choose whether to capture the current AI config.',
            })}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.titleLabel', { defaultValue: 'Title' })}
            </span>
            <input
              value={draft.title}
              onChange={(event) => props.onDraftChange({ ...draft, title: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'My AI Profile' })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.descriptionLabel', { defaultValue: 'Description' })}
            </span>
            <textarea
              value={draft.description}
              onChange={(event) => props.onDraftChange({ ...draft, description: event.target.value })}
              className="mt-1 min-h-24 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: 'Describe this profile...' })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.tagsLabel', { defaultValue: 'Tags' })}
            </span>
            <input
              value={draft.tagsText}
              onChange={(event) => props.onDraftChange({ ...draft, tagsText: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.tagsPlaceholder', { defaultValue: 'local, writing, fast' })}
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={draft.replaceWithCurrentConfig}
              onChange={(event) => props.onDraftChange({ ...draft, replaceWithCurrentConfig: event.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            <span>
              <span className="block text-xs font-medium text-slate-800">
                {draft.mode === 'create'
                  ? t('runtimeConfig.profiles.captureCurrentConfig', { defaultValue: 'Create from current AI config' })
                  : t('runtimeConfig.profiles.replaceWithCurrentConfig', { defaultValue: 'Replace capabilities with current AI config' })}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {t('runtimeConfig.profiles.captureCurrentConfigHint', {
                  defaultValue: 'This changes the profile template only; applying it to a scope remains preview-gated.',
                })}
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={props.saving || draft.title.trim().length === 0}
            onClick={props.onSave}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:pointer-events-none disabled:opacity-50"
          >
            {props.saving
              ? t('runtimeConfig.profiles.saving', { defaultValue: 'Saving...' })
              : t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * Library management strip: import / export of editable library profiles and
 * explicit factory-restore. Profile-level capability editing lives in the kit
 * AI Config component below; this strip only manages the file-backed library
 * and the explicit restore-to-Account-Default action.
 */
function ProfileLibraryActions(props: {
  onRestoreToAccountDefault: () => void;
  restoring: boolean;
  exportCount: number;
  onLibraryChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const {
    exportCount,
    onLibraryChanged,
    onRestoreToAccountDefault,
    restoring,
  } = props;
  const [feedback, setFeedback] = useState<ProfileFeedback>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    try {
      const profiles = await exportAccountProfileLibraryEntries();
      if (profiles.length === 0) {
        setFeedback({
          type: 'error',
          message: t('runtimeConfig.profiles.exportEmpty', { defaultValue: 'No editable profiles to export.' }),
        });
        return;
      }
      const json = JSON.stringify(profiles, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nimi-ai-profiles-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to export profiles.',
      });
    }
  }, [t]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(reader.result || ''));
        } catch {
          setFeedback({ type: 'error', message: t('runtimeConfig.profiles.invalidJson', { defaultValue: 'Invalid JSON' }) });
          return;
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const candidates: AIProfile[] = [];
        const errors: string[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const result = validateAIProfile(items[index]);
          if (result.valid) {
            candidates.push(items[index] as AIProfile);
          } else {
            errors.push(`Item ${index}: ${result.errors.join(', ')}`);
          }
        }
        if (candidates.length === 0) {
          setFeedback({
            type: 'error',
            message: errors.join('; ') || t('runtimeConfig.profiles.importNone', { defaultValue: 'No valid profiles found.' }),
          });
          return;
        }
        try {
          await importAccountProfileLibraryEntries(candidates);
          await onLibraryChanged();
          setFeedback({
            type: 'success',
            message: t('runtimeConfig.profiles.importSuccess', {
              defaultValue: 'Imported {{count}} profile(s).',
              count: candidates.length,
            }),
          });
        } catch (error: unknown) {
          setFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to import profiles.',
          });
        }
      })();
    };
    reader.readAsText(file);
  }, [onLibraryChanged, t]);

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="runtime-profiles-library-actions"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t('runtimeConfig.profiles.libraryTitle', { defaultValue: 'Profile Library' })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('runtimeConfig.profiles.librarySubtitle', {
              defaultValue: 'Import, export, and restore your account profile library.',
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="runtime-profiles-import"
            onClick={handleImportClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50"
          >
            {t('runtimeConfig.profiles.import', { defaultValue: 'Import' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-export"
            onClick={() => { void handleExport(); }}
            disabled={exportCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('runtimeConfig.profiles.export', { defaultValue: 'Export' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-factory-restore"
            onClick={onRestoreToAccountDefault}
            disabled={restoring}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-medium text-amber-700 shadow-sm transition-all hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {restoring
              ? t('runtimeConfig.profiles.restoring', { defaultValue: 'Restoring...' })
              : t('runtimeConfig.profiles.factoryRestore', { defaultValue: 'Restore to Account Default' })}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>
      {feedback ? (
        <p
          className={
            feedback.type === 'success'
              ? 'mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700 ring-1 ring-green-200'
              : 'mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200'
          }
          role="status"
        >
          {feedback.message}
          <button
            type="button"
            className="ml-2 opacity-60 hover:opacity-100"
            onClick={() => setFeedback(null)}
          >
            {t('runtimeConfig.profiles.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </p>
      ) : null}
    </section>
  );
}

function AccountProfileLibraryPanel(props: {
  projection: AccountProfileLibraryProjection | null;
  accountDefaultProfile: AIProfile | null;
  currentOrigin: { profileId: string; title?: string | null } | null;
  loading: boolean;
  busyProfileId: string | null;
  onRefresh: () => void;
  onApply: (profileId: string) => void;
  onCreate: () => void;
  onEdit: (entry: LibraryProfile) => void;
  onReplaceFromCurrent: (entry: LibraryProfile) => void;
  onDelete: (entry: LibraryProfile) => void;
}) {
  const { t } = useTranslation();
  const defaultCapabilityCount = props.accountDefaultProfile
    ? countConfiguredCapabilities(props.accountDefaultProfile)
    : 0;
  const entries = props.projection?.profiles ?? [];
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="runtime-profiles-account-library"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {t('runtimeConfig.profiles.accountLibraryTitle', { defaultValue: 'AI Profiles' })}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t('runtimeConfig.profiles.accountLibrarySubtitle', {
              defaultValue: 'Create, edit, switch, import, and export account AI profiles. Profiles are presets; applying one updates the current scope only after preview.',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="runtime-profiles-refresh"
            onClick={props.onRefresh}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {props.loading
              ? t('runtimeConfig.profiles.loading', { defaultValue: 'Loading profiles...' })
              : t('runtimeConfig.profiles.reload', { defaultValue: 'Reload' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-create"
            onClick={props.onCreate}
            className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600"
          >
            {t('runtimeConfig.profiles.create', { defaultValue: '+ Create Profile' })}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <article
          className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3"
          data-testid="runtime-profiles-account-default-row"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-950">
                  {props.accountDefaultProfile?.title
                    || t('runtimeConfig.profiles.accountDefaultTitle', { defaultValue: 'Default Profile' })}
                </h4>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  {t('runtimeConfig.profiles.accountDefaultBadge', { defaultValue: 'Account default' })}
                </span>
                {props.currentOrigin?.profileId === props.accountDefaultProfile?.profileId ? (
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('runtimeConfig.profiles.currentBadge', { defaultValue: 'Current' })}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {props.accountDefaultProfile?.description
                  || t('runtimeConfig.profiles.accountDefaultDescription', {
                    defaultValue: 'Created during onboarding and available like any other profile for switching.',
                  })}
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                {t('runtimeConfig.profiles.capabilityCount', {
                  defaultValue: '{{count}} configured capabilities',
                  count: defaultCapabilityCount,
                })}
              </p>
            </div>
            <button
              type="button"
              disabled={!props.accountDefaultProfile || props.busyProfileId === props.accountDefaultProfile.profileId}
              onClick={() => {
                if (props.accountDefaultProfile) props.onApply(props.accountDefaultProfile.profileId);
              }}
              className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:pointer-events-none disabled:opacity-50"
            >
              {t('runtimeConfig.profiles.applyProfile', { defaultValue: 'Apply' })}
            </button>
          </div>
        </article>

        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            {t('runtimeConfig.profiles.noCustom', { defaultValue: 'No custom profiles yet. Create one or import from a file.' })}
          </div>
        ) : entries.map((entry) => {
          const profile = entry.profile;
          const current = props.currentOrigin?.profileId === profile.profileId;
          return (
            <article
              key={profile.profileId}
              className="rounded-xl border border-slate-200 bg-white p-3"
              data-testid="runtime-profiles-library-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-950">{profile.title}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {entry.origin}
                    </span>
                    {current ? (
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-white">
                        {t('runtimeConfig.profiles.currentBadge', { defaultValue: 'Current' })}
                      </span>
                    ) : null}
                  </div>
                  {profile.description ? (
                    <p className="mt-1 text-xs text-slate-600">{profile.description}</p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('runtimeConfig.profiles.capabilityCount', {
                      defaultValue: '{{count}} configured capabilities',
                      count: countConfiguredCapabilities(profile),
                    })}
                    {' · '}
                    {t('runtimeConfig.profiles.updatedAt', {
                      defaultValue: 'Updated {{time}}',
                      time: entry.updatedAt || '-',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => props.onApply(profile.profileId)}
                    className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    {t('runtimeConfig.profiles.applyProfile', { defaultValue: 'Apply' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onEdit(entry)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('runtimeConfig.profiles.edit', { defaultValue: 'Edit' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onReplaceFromCurrent(entry)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('runtimeConfig.profiles.updateFromCurrent', { defaultValue: 'Update from current' })}
                  </button>
                  <button
                    type="button"
                    disabled={!entry.removable}
                    onClick={() => props.onDelete(entry)}
                    className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {t('runtimeConfig.profiles.delete', { defaultValue: 'Delete' })}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const [restoring, setRestoring] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<ProfileFeedback>(null);
  const [libraryProjection, setLibraryProjection] = useState<AccountProfileLibraryProjection | null>(null);
  const [accountDefaultProfile, setAccountDefaultProfile] = useState<AIProfile | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryFeedback, setLibraryFeedback] = useState<ProfileFeedback>(null);
  const [editorDraft, setEditorDraft] = useState<ProfileEditorDraft | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const profileReloadRef = useRef<(() => void) | undefined>(undefined);

  const refreshProfileLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const [projection, defaultProfile] = await Promise.all([
        loadAccountProfileLibrary(),
        getAccountDefaultProfileForScopeInit(),
      ]);
      setLibraryProjection(projection);
      setAccountDefaultProfile(toEditableAIProfile(defaultProfile));
      return projection;
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    enabledCapabilities: RUNTIME_ENABLED_CAPABILITIES,
    providerResolver: (routeCapability: string) => getDesktopRouteModelPickerProvider(routeCapability),
    projectionResolver: () => null,
    runtimeReady: true,
    localAssetSource: {
      list: () => assetsQuery.data || [],
      loading: assetsQuery.isLoading,
    },
    i18n: { t },
  }), [aiConfig.scopeRef, aiConfigService, assetsQuery.data, assetsQuery.isLoading, t]);

  const profileCopy = useMemo(() => ({
    ...defaultModelConfigProfileCopy(t),
    importLabel: t('runtimeConfig.profiles.switchProfile', { defaultValue: 'Switch AI Profile' }),
    modalTitle: t('runtimeConfig.profiles.switchProfileModalTitle', { defaultValue: 'Switch AI Profile' }),
    modalHint: t('runtimeConfig.profiles.switchProfileModalHint', {
      defaultValue: 'Choose a profile to preview the changes before applying it to this scope.',
    }),
  }), [t]);

  const userProfilesSource = useMemo(
    () => ({
      list: () => [
        ...(accountDefaultProfile ? [accountDefaultProfile] : []),
        ...getCachedAccountProfileLibraryProfiles(),
      ],
    }),
    [accountDefaultProfile],
  );

  const currentOrigin = useMemo(
    () => (aiConfig.profileOrigin
      ? { profileId: aiConfig.profileOrigin.profileId, title: aiConfig.profileOrigin.title }
      : null),
    [aiConfig.profileOrigin?.profileId, aiConfig.profileOrigin?.title],
  );

  const profile = useModelConfigProfileController({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    copy: profileCopy,
    applyAIProfileToConfig,
    userProfilesSource,
    currentOrigin,
  });

  useEffect(() => {
    profileReloadRef.current = profile.onReload;
  }, [profile.onReload]);

  // Prime the file-backed account profile library and force the kit controller
  // to reload once the synchronous userProfilesSource can see host truth.
  useEffect(() => {
    let cancelled = false;
    void refreshProfileLibrary()
      .then(() => {
        if (!cancelled) profileReloadRef.current?.();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibraryFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to load profiles.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshProfileLibrary]);

  const reloadLibraryAndProfileController = useCallback(async () => {
    await refreshProfileLibrary();
    profileReloadRef.current?.();
  }, [refreshProfileLibrary]);

  const openCreateProfile = useCallback(() => {
    const base = {
      profileId: generateLibraryProfileId(),
      title: '',
      description: '',
      tags: [],
      capabilities: profileCapabilitiesFromAIConfig(aiConfig.capabilities),
    };
    setEditorDraft({
      mode: 'create',
      profile: base,
      title: '',
      description: '',
      tagsText: '',
      replaceWithCurrentConfig: true,
    });
  }, [aiConfig.capabilities]);

  const openEditProfile = useCallback((entry: LibraryProfile) => {
    setEditorDraft({
      mode: 'edit',
      profile: entry.profile,
      title: entry.profile.title,
      description: entry.profile.description,
      tagsText: entry.profile.tags.join(', '),
      replaceWithCurrentConfig: false,
    });
  }, []);

  const saveEditorDraft = useCallback(() => {
    if (!editorDraft) return;
    setEditorSaving(true);
    setLibraryFeedback(null);
    void (async () => {
      try {
        const nextProfile: AIProfile = {
          ...editorDraft.profile,
          title: editorDraft.title.trim(),
          description: editorDraft.description,
          tags: normalizeTags(editorDraft.tagsText),
          capabilities: editorDraft.replaceWithCurrentConfig
            ? profileCapabilitiesFromAIConfig(aiConfig.capabilities)
            : editorDraft.profile.capabilities,
        };
        const validation = validateAIProfile(nextProfile);
        if (!validation.valid) {
          throw new Error(validation.errors.join(', '));
        }
        if (editorDraft.mode === 'create') {
          await createAccountProfileLibraryEntry(nextProfile);
        } else {
          await editAccountProfileLibraryEntry(nextProfile);
        }
        await reloadLibraryAndProfileController();
        setEditorDraft(null);
        setLibraryFeedback({
          type: 'success',
          message: t('runtimeConfig.profiles.saved', { defaultValue: 'Profile saved.' }),
        });
      } catch (error: unknown) {
        setLibraryFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to save profile.',
        });
      } finally {
        setEditorSaving(false);
      }
    })();
  }, [aiConfig.capabilities, editorDraft, reloadLibraryAndProfileController, t]);

  const replaceProfileFromCurrentConfig = useCallback((entry: LibraryProfile) => {
    setEditorDraft({
      mode: 'edit',
      profile: entry.profile,
      title: entry.profile.title,
      description: entry.profile.description,
      tagsText: entry.profile.tags.join(', '),
      replaceWithCurrentConfig: true,
    });
  }, []);

  const deleteProfile = useCallback((entry: LibraryProfile) => {
    setLibraryFeedback(null);
    void (async () => {
      try {
        await deleteAccountProfileLibraryEntry(entry.profileId);
        await reloadLibraryAndProfileController();
        setLibraryFeedback({
          type: 'success',
          message: t('runtimeConfig.profiles.deleted', { defaultValue: 'Profile deleted.' }),
        });
      } catch (error: unknown) {
        setLibraryFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to delete profile.',
        });
      }
    })();
  }, [reloadLibraryAndProfileController, t]);

  // Explicit factory-restore: re-apply the file-backed Account Default Profile
  // to the active scope. This routes through the kit controller's preview-gated
  // apply (D-AIPC-014) — the user confirms the before→after diff before any
  // D-AIPC-005 commit. No library file family mutation is performed here.
  const handleRestoreToAccountDefault = useCallback(() => {
    setRestoring(true);
    setRestoreFeedback(null);
    void (async () => {
      try {
        const accountDefault = await getAccountDefaultProfileForScopeInit();
        profile.onApply(accountDefault.profileId);
        setRestoreFeedback({
          type: 'success',
          message: t('runtimeConfig.profiles.restorePreview', {
            defaultValue: 'Review the Account Default changes below, then confirm to apply.',
          }),
        });
      } catch (error: unknown) {
        setRestoreFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load the Account Default Profile.',
        });
      } finally {
        setRestoring(false);
      }
    })();
  }, [profile, t]);

  return (
    <RuntimePageShell>
      <ProfileLibraryActions
        onRestoreToAccountDefault={handleRestoreToAccountDefault}
        restoring={restoring}
        exportCount={libraryProjection?.profiles.length ?? 0}
        onLibraryChanged={reloadLibraryAndProfileController}
      />
      <AccountProfileLibraryPanel
        projection={libraryProjection}
        accountDefaultProfile={accountDefaultProfile}
        currentOrigin={currentOrigin}
        loading={libraryLoading}
        busyProfileId={null}
        onRefresh={() => { void reloadLibraryAndProfileController(); }}
        onApply={(profileId) => profile.onApply(profileId)}
        onCreate={openCreateProfile}
        onEdit={openEditProfile}
        onReplaceFromCurrent={replaceProfileFromCurrentConfig}
        onDelete={deleteProfile}
      />
      {libraryFeedback ? (
        <p
          className={
            libraryFeedback.type === 'success'
              ? 'rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700 ring-1 ring-green-200'
              : 'rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200'
          }
          role="status"
          data-testid="runtime-profiles-library-feedback"
        >
          {libraryFeedback.message}
        </p>
      ) : null}
      {restoreFeedback ? (
        <p
          className={
            restoreFeedback.type === 'success'
              ? 'rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 ring-1 ring-blue-200'
              : 'rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200'
          }
          role="status"
          data-testid="runtime-profiles-restore-feedback"
        >
          {restoreFeedback.message}
        </p>
      ) : null}
      <ModelConfigAiModelHub surface={surface} profile={profile} />
      {editorDraft ? (
        <ProfileEditorModal
          draft={editorDraft}
          saving={editorSaving}
          onDraftChange={setEditorDraft}
          onCancel={() => setEditorDraft(null)}
          onSave={saveEditorDraft}
        />
      ) : null}
    </RuntimePageShell>
  );
}
