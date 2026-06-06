/**
 * Profiles section — canonical six-section Runtime IA.
 *
 * Runtime > Profiles is account AIProfile library management only. It does
 * not read the current scope AIConfig, does not derive profile bodies from
 * AIConfig, and does not apply profiles to an implicit scope. Concrete app /
 * module / feature scope apply remains owned by those scope surfaces.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiAIProfile } from '@nimiplatform/sdk/ai';
import { validateNimiAIProfile } from '@nimiplatform/sdk/ai';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { AccountProfileLibraryPanel } from './runtime-config-profile-library-panel.js';
import {
  ProfileEditorModal,
  ProfileLibraryActions,
  type ProfileEditorDraft,
  type ProfileFeedback,
} from './runtime-config-profile-management-sections.js';
import {
  createEmptyLibraryProfile,
  createAccountProfileLibraryEntry,
  deleteAccountProfileLibraryEntry,
  editAccountProfileLibraryEntry,
  loadAccountProfileLibrary,
  type NimiAccountProfileLibraryProjection,
  type LibraryProfile,
} from './runtime-config-profile-library.js';

const PROFILE_BODY_RESERVED_FIELDS = [
  'profileId',
  'title',
  'description',
  'tags',
  'scopeRef',
  'profileOrigin',
] as const;

function normalizeTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function profileBodyJson(profile: NimiAIProfile): string {
  const body: { [key: string]: unknown } = {};
  if (profile.version !== undefined) body.version = profile.version;
  if (profile.revision !== undefined) body.revision = profile.revision;
  body.capabilities = profile.capabilities;
  if (profile.assetBindings !== undefined) body.assetBindings = profile.assetBindings;
  if (profile.defaultParams !== undefined) body.defaultParams = profile.defaultParams;
  if (profile.editableFields !== undefined) body.editableFields = profile.editableFields;
  if (profile.prepareRequirements !== undefined) body.prepareRequirements = profile.prepareRequirements;
  if (profile.contractStates !== undefined) body.contractStates = profile.contractStates;
  if (profile.projectionWarnings !== undefined) body.projectionWarnings = profile.projectionWarnings;
  return JSON.stringify(body, null, 2);
}

function buildProfileFromEditorDraft(draft: ProfileEditorDraft): NimiAIProfile {
  const parsed = JSON.parse(draft.profileJsonText) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error('Portable profile body must be a JSON object.');
  }
  const reserved = PROFILE_BODY_RESERVED_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(parsed, field)
  ));
  if (reserved.length > 0) {
    throw new Error(`Portable profile body must not include: ${reserved.join(', ')}`);
  }
  const nextProfile = {
    ...parsed,
    profileId: draft.profile.profileId,
    title: draft.title.trim(),
    description: draft.description,
    tags: normalizeTags(draft.tagsText),
  } as unknown as NimiAIProfile;
  const validation = validateNimiAIProfile(nextProfile);
  if (!validation.valid) {
    throw new Error(validation.errors.join(', '));
  }
  return nextProfile;
}

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const [libraryProjection, setLibraryProjection] = useState<NimiAccountProfileLibraryProjection | null>(null);
  const [accountDefaultProfile, setAccountDefaultProfile] = useState<NimiAIProfile | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryFeedback, setLibraryFeedback] = useState<ProfileFeedback>(null);
  const [editorDraft, setEditorDraft] = useState<ProfileEditorDraft | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);

  const refreshProfileLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const [projection, defaultProfile] = await Promise.all([
        loadAccountProfileLibrary(),
        getAccountDefaultProfileForScopeInit(),
      ]);
      setLibraryProjection(projection);
      setAccountDefaultProfile(defaultProfile);
      return projection;
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  // Prime the file-backed account profile library projection.
  useEffect(() => {
    let cancelled = false;
    void refreshProfileLibrary()
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

  const reloadProfileLibrary = useCallback(async () => {
    await refreshProfileLibrary();
  }, [refreshProfileLibrary]);

  const openCreateProfile = useCallback(() => {
    const base = createEmptyLibraryProfile();
    setEditorDraft({
      mode: 'create',
      profile: base,
      title: '',
      description: '',
      tagsText: '',
      profileJsonText: profileBodyJson(base),
    });
  }, []);

  const openEditProfile = useCallback((entry: LibraryProfile) => {
    setEditorDraft({
      mode: 'edit',
      profile: entry.profile,
      title: entry.profile.title,
      description: entry.profile.description ?? '',
      tagsText: (entry.profile.tags ?? []).join(', '),
      profileJsonText: profileBodyJson(entry.profile),
    });
  }, []);

  const saveEditorDraft = useCallback(() => {
    if (!editorDraft) return;
    setEditorSaving(true);
    setLibraryFeedback(null);
    void (async () => {
      try {
        const nextProfile = buildProfileFromEditorDraft(editorDraft);
        if (editorDraft.mode === 'create') {
          await createAccountProfileLibraryEntry(nextProfile);
        } else {
          await editAccountProfileLibraryEntry(nextProfile);
        }
        await reloadProfileLibrary();
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
  }, [editorDraft, reloadProfileLibrary, t]);

  const deleteProfile = useCallback((entry: LibraryProfile) => {
    setLibraryFeedback(null);
    void (async () => {
      try {
        await deleteAccountProfileLibraryEntry(entry.profileId);
        await reloadProfileLibrary();
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
  }, [reloadProfileLibrary, t]);

  return (
    <RuntimePageShell>
      <ProfileLibraryActions
        exportCount={libraryProjection?.profiles.length ?? 0}
        onLibraryChanged={reloadProfileLibrary}
      />
      <AccountProfileLibraryPanel
        projection={libraryProjection}
        accountDefaultProfile={accountDefaultProfile}
        loading={libraryLoading}
        onRefresh={() => { void reloadProfileLibrary(); }}
        onCreate={openCreateProfile}
        onEdit={openEditProfile}
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
