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
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIProfile,
  NimiAIProfileCapabilityIntent,
} from '@nimiplatform/sdk/ai';
import { validateNimiAIProfile } from '@nimiplatform/sdk/ai';
import {
  CANONICAL_CAPABILITY_CATALOG,
} from '@nimiplatform/kit/core/runtime-capabilities';
import type { AppModelConfigSurface } from '@nimiplatform/kit/features/model-config';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
} from '@nimiplatform/kit/features/model-config';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { AccountProfileLibraryPanel } from './runtime-config-profile-library-panel.js';
import {
  ProfileEditorModal,
  ProfileLibraryActions,
  type ProfileEditorDraft,
  type ProfileFeedback,
} from './runtime-config-profile-management-sections.js';
import { getDesktopRouteModelPickerProvider } from './desktop-route-model-picker-provider.js';
import { useLocalAssets } from '../chat/capability-settings-shared.js';
import {
  createAccountProfileLibraryEntry,
  deleteAccountProfileLibraryEntry,
  editAccountProfileLibraryEntry,
  generateLibraryProfileId,
  getCachedAccountProfileLibraryProfiles,
  loadAccountProfileLibrary,
  type NimiAccountProfileLibraryProjection,
  type LibraryProfile,
} from './runtime-config-profile-library.js';

// Account default profile spans every canonical capability.
const RUNTIME_ENABLED_CAPABILITIES = Object.freeze(
  CANONICAL_CAPABILITY_CATALOG.map((descriptor) => descriptor.capabilityId),
);

function modelConfigRequirementDeclaration(
  scopeRef: NimiAIConfig['scopeRef'],
  capabilities: readonly string[],
): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: `desktop.runtime-config.profiles:${scopeRef.kind}:${scopeRef.ownerId}:${scopeRef.surfaceId ?? 'default'}`,
    scopeRef,
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `runtime-config:${capability}`,
      capability,
      profileSliceRef: `runtime-config:${capability}`,
      readinessPolicy: 'required',
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

function profileCapabilitiesFromAIConfig(
  capabilities: NimiAIConfig['capabilities'],
): NimiAIProfile['capabilities'] {
  const out: Record<string, NimiAIProfileCapabilityIntent | null | undefined> = {};
  const capabilityIds = new Set([
    ...Object.keys(capabilities.targetRefs ?? {}),
    ...Object.keys(capabilities.selectedParams ?? {}),
  ]);
  for (const capabilityId of capabilityIds) {
    out[capabilityId] = {
      targetRef: capabilities.targetRefs?.[capabilityId] ?? null,
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

function toEditableAIProfile(profile: {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly capabilities: NimiAIProfile['capabilities'];
}): NimiAIProfile {
  return {
    profileId: profile.profileId,
    title: profile.title,
    description: profile.description ?? '',
    tags: [...(profile.tags ?? [])],
    capabilities: { ...profile.capabilities } as NimiAIProfile['capabilities'],
  };
}

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const [restoring, setRestoring] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<ProfileFeedback>(null);
  const [libraryProjection, setLibraryProjection] = useState<NimiAccountProfileLibraryProjection | null>(null);
  const [accountDefaultProfile, setAccountDefaultProfile] = useState<NimiAIProfile | null>(null);
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
    requirementDeclaration: modelConfigRequirementDeclaration(aiConfig.scopeRef, RUNTIME_ENABLED_CAPABILITIES),
    providerResolver: (routeCapability: string) => getDesktopRouteModelPickerProvider(routeCapability),
    projectionResolver: () => null,
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
      description: entry.profile.description ?? '',
      tagsText: (entry.profile.tags ?? []).join(', '),
      replaceWithCurrentConfig: false,
    });
  }, []);

  const saveEditorDraft = useCallback(() => {
    if (!editorDraft) return;
    setEditorSaving(true);
    setLibraryFeedback(null);
    void (async () => {
      try {
        const nextProfile: NimiAIProfile = {
          ...editorDraft.profile,
          title: editorDraft.title.trim(),
          description: editorDraft.description,
          tags: normalizeTags(editorDraft.tagsText),
          capabilities: editorDraft.replaceWithCurrentConfig
            ? profileCapabilitiesFromAIConfig(aiConfig.capabilities)
            : editorDraft.profile.capabilities,
        };
        const validation = validateNimiAIProfile(nextProfile);
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
      description: entry.profile.description ?? '',
      tagsText: (entry.profile.tags ?? []).join(', '),
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
