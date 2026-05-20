/**
 * Profiles section — canonical six-section Runtime IA.
 *
 * The profile editing surface converges onto the Nimi Kit AI Config component
 * (`ModelConfigAiModelHub`): capability config, profile selection, and
 * preview-gated apply (D-AIPC-014 / S-AICONF-008) are all owned by the kit.
 * The bespoke `runtime-config-profile-editor.tsx` is retired.
 *
 * The Account Default Profile is file-backed (P-AIPS-013 `account_profile_library`);
 * the library access layer (`runtime-config-profile-library`) feeds the kit's
 * synchronous `userProfilesSource`. This section exposes:
 *   - import / export of editable library profiles
 *   - per-capability edit via the kit AI Config component
 *   - explicit factory-restore (preview-gated re-apply of the file-backed
 *     Account Default Profile to the active scope)
 *   - the "Active Default Profile for new scopes" indicator (ordinary task 2),
 *     surfaced by the kit hub via `currentOrigin`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIProfile } from '@nimiplatform/sdk/mod';
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
  ensureAccountProfileLibraryLoaded,
  exportAccountProfileLibraryEntries,
  getCachedAccountProfileLibrary,
  getCachedAccountProfileLibraryProfiles,
  importAccountProfileLibraryEntries,
  loadAccountProfileLibrary,
} from './runtime-config-profile-library.js';

// Account default profile spans every canonical capability.
const RUNTIME_ENABLED_CAPABILITIES = Object.freeze(
  CANONICAL_CAPABILITY_CATALOG.map((descriptor) => descriptor.capabilityId),
);

type ProfileFeedback = { type: 'success' | 'error'; message: string } | null;

/**
 * Library management strip: import / export of editable library profiles and
 * explicit factory-restore. Profile-level capability editing lives in the kit
 * AI Config component below; this strip only manages the file-backed library
 * and the explicit restore-to-Account-Default action.
 */
function ProfileLibraryActions(props: {
  onRestoreToAccountDefault: () => void;
  restoring: boolean;
}) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<ProfileFeedback>(null);
  const [exportCount, setExportCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prime the read-through projection so export reflects host truth.
  useEffect(() => {
    let cancelled = false;
    void ensureAccountProfileLibraryLoaded()
      .then(() => {
        if (cancelled) return;
        const library = getCachedAccountProfileLibrary();
        setExportCount(library?.profiles.length ?? 0);
      })
      .catch(() => {
        // Projection priming failure is non-fatal for the action strip.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshExportCount = useCallback(async () => {
    const library = await loadAccountProfileLibrary();
    setExportCount(library.profiles.length);
  }, []);

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
          await refreshExportCount();
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
  }, [refreshExportCount, t]);

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
            onClick={props.onRestoreToAccountDefault}
            disabled={props.restoring}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-medium text-amber-700 shadow-sm transition-all hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {props.restoring
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

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const [restoring, setRestoring] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<ProfileFeedback>(null);

  // Prime the read-through projection of the file-backed account profile
  // library so the kit's synchronous `userProfilesSource.list()` reflects host
  // truth (P-AIPS-013: the library file family is the source of truth).
  useEffect(() => {
    void ensureAccountProfileLibraryLoaded();
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

  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);

  const userProfilesSource = useMemo(
    () => ({ list: () => getCachedAccountProfileLibraryProfiles() }),
    [],
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
      />
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
    </RuntimePageShell>
  );
}
