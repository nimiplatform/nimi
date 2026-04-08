/**
 * AI Profile Catalog page — browse, create, edit, import/export profiles.
 *
 * Three sections:
 *   1. Recommended — runtime built-in profiles with recommended=true
 *   2. Built-in — runtime built-in profiles with recommended=false
 *   3. Custom — user-created profiles (localStorage)
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { AIProfile } from '@nimiplatform/sdk/mod';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { ProfileEditor } from './runtime-config-profile-editor.js';
import {
  loadUserProfiles,
  saveUserProfile,
  deleteUserProfile,
  exportProfiles,
  importProfiles,
  createEmptyUserProfile,
  generateProfileId,
} from './runtime-config-profile-storage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProfileOrigin = 'recommended' | 'builtin' | 'custom';

type CatalogProfile = {
  profile: AIProfile;
  origin: ProfileOrigin;
  recommended: boolean;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useRuntimeProfiles() {
  const surface = useMemo(() => getDesktopAIConfigService(), []);
  return useQuery({
    queryKey: ['ai-profiles', 'catalog'],
    queryFn: () => surface.aiProfile.list(),
    staleTime: 30_000,
  });
}

function useUserProfiles(version: number) {
  return useMemo(() => loadUserProfiles(), [version]);
}

// ---------------------------------------------------------------------------
// Capability summary icons
// ---------------------------------------------------------------------------

const CAPABILITY_ICON_MAP: Record<string, string> = {
  'text.generate': 'Chat',
  'speech.synthesize': 'TTS',
  'image.generate': 'Image',
  'image.edit': 'Image',
  'video.generate': 'Video',
};

function CapabilitySummary(props: { capabilities: AIProfile['capabilities'] }) {
  const caps = Object.keys(props.capabilities);
  const labels = [...new Set(caps.map((c) => CAPABILITY_ICON_MAP[c] || c))];
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

function ProfileCard(props: {
  entry: CatalogProfile;
  onApply: (profileId: string) => void;
  onEdit?: (profile: AIProfile) => void;
  onDelete?: (profileId: string) => void;
  onDuplicate: (profile: AIProfile) => void;
  applying: boolean;
}) {
  const { t } = useTranslation();
  const { profile, origin, recommended } = props.entry;

  return (
    <div className="group relative flex flex-col gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-4 transition-colors hover:border-[var(--nimi-border-strong)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
              {profile.title || profile.profileId}
            </h4>
            {recommended ? (
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                {t('runtimeConfig.profiles.recommended', { defaultValue: 'Recommended' })}
              </span>
            ) : null}
            {origin === 'custom' ? (
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-500">
                {t('runtimeConfig.profiles.custom', { defaultValue: 'Custom' })}
              </span>
            ) : null}
          </div>
          {profile.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--nimi-text-muted)]">
              {profile.description}
            </p>
          ) : null}
        </div>
      </div>

      <CapabilitySummary capabilities={profile.capabilities} />

      {profile.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {profile.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={props.applying}
          className="rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          onClick={() => props.onApply(profile.profileId)}
        >
          {t('runtimeConfig.profiles.apply', { defaultValue: 'Apply' })}
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-[11px] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
          onClick={() => props.onDuplicate(profile)}
        >
          {t('runtimeConfig.profiles.duplicate', { defaultValue: 'Duplicate' })}
        </button>
        {origin === 'custom' && props.onEdit ? (
          <button
            type="button"
            className="rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-[11px] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
            onClick={() => props.onEdit!(profile)}
          >
            {t('runtimeConfig.profiles.edit', { defaultValue: 'Edit' })}
          </button>
        ) : null}
        {origin === 'custom' && props.onDelete ? (
          <button
            type="button"
            className="rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 py-1.5 text-[11px] text-[var(--nimi-status-danger)] hover:bg-red-50 transition-colors"
            onClick={() => props.onDelete!(profile.profileId)}
          >
            {t('runtimeConfig.profiles.delete', { defaultValue: 'Delete' })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function CatalogSection(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
        {props.title}
      </h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {props.children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const runtimeQuery = useRuntimeProfiles();
  const [userVersion, setUserVersion] = useState(0);
  const userProfiles = useUserProfiles(userVersion);
  const [editingProfile, setEditingProfile] = useState<AIProfile | null>(null);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scopeRef = useAppStore((state) => state.aiConfig.scopeRef);
  const surface = useMemo(() => getDesktopAIConfigService(), []);

  // Categorize runtime profiles — note: runtime profiles don't carry `recommended`
  // on AIProfile, but the underlying LocalRuntimeProfileDescriptor does.
  // We check tags or title heuristics, but the primary signal is from the runtime query.
  // For now, all runtime profiles go into "Built-in" since the bridge doesn't expose recommended.
  const catalogEntries = useMemo((): CatalogProfile[] => {
    const entries: CatalogProfile[] = [];

    // Runtime profiles
    for (const p of runtimeQuery.data || []) {
      entries.push({
        profile: p,
        origin: 'builtin',
        recommended: false,
      });
    }

    // User profiles
    for (const p of userProfiles) {
      entries.push({
        profile: p,
        origin: 'custom',
        recommended: false,
      });
    }

    return entries;
  }, [runtimeQuery.data, userProfiles]);

  const recommendedEntries = catalogEntries.filter((e) => e.recommended);
  const builtinEntries = catalogEntries.filter((e) => e.origin === 'builtin' && !e.recommended);
  const customEntries = catalogEntries.filter((e) => e.origin === 'custom');

  // -- Actions --

  const refreshUserProfiles = useCallback(() => {
    setUserVersion((v) => v + 1);
  }, []);

  const handleApply = useCallback(async (profileId: string) => {
    setApplying(true);
    setFeedback(null);
    try {
      // Try runtime surface first (for built-in profiles)
      const result = await surface.aiProfile.apply(scopeRef, profileId);
      if (result.success) {
        setFeedback({ type: 'success', message: t('runtimeConfig.profiles.applySuccess', { defaultValue: 'Profile applied successfully.' }) });
      } else {
        // Maybe it's a user profile — apply manually
        const userProfile = userProfiles.find((p) => p.profileId === profileId);
        if (userProfile) {
          const { applyAIProfileToConfig } = await import('@nimiplatform/sdk/mod');
          const currentConfig = surface.aiConfig.get(scopeRef);
          const newConfig = applyAIProfileToConfig(currentConfig, userProfile);
          surface.aiConfig.update(scopeRef, newConfig);
          setFeedback({ type: 'success', message: t('runtimeConfig.profiles.applySuccess', { defaultValue: 'Profile applied successfully.' }) });
        } else {
          setFeedback({ type: 'error', message: result.failureReason || 'Failed to apply profile.' });
        }
      }
    } catch (error: unknown) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to apply profile.' });
    } finally {
      setApplying(false);
    }
  }, [surface, scopeRef, userProfiles, t]);

  const handleSaveProfile = useCallback((profile: AIProfile) => {
    saveUserProfile(profile);
    refreshUserProfiles();
    setEditingProfile(null);
    setFeedback({ type: 'success', message: t('runtimeConfig.profiles.saved', { defaultValue: 'Profile saved.' }) });
  }, [refreshUserProfiles, t]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    deleteUserProfile(profileId);
    refreshUserProfiles();
    setFeedback({ type: 'success', message: t('runtimeConfig.profiles.deleted', { defaultValue: 'Profile deleted.' }) });
  }, [refreshUserProfiles, t]);

  const handleDuplicate = useCallback((profile: AIProfile) => {
    const copy = structuredClone(profile);
    copy.profileId = generateProfileId();
    copy.title = `${profile.title} (Copy)`;
    setEditingProfile(copy);
  }, []);

  const handleCreate = useCallback(() => {
    setEditingProfile(createEmptyUserProfile());
  }, []);

  // -- Import / Export --

  const handleExport = useCallback(() => {
    const profilesToExport = customEntries.map((e) => e.profile);
    if (profilesToExport.length === 0) return;
    const json = exportProfiles(profilesToExport);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [customEntries]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importProfiles(reader.result as string);
      for (const profile of result.imported) {
        saveUserProfile(profile);
      }
      refreshUserProfiles();
      if (result.imported.length > 0) {
        setFeedback({
          type: 'success',
          message: t('runtimeConfig.profiles.importSuccess', {
            defaultValue: 'Imported {{count}} profile(s).',
            count: result.imported.length,
          }),
        });
      }
      if (result.errors.length > 0) {
        setFeedback({
          type: 'error',
          message: result.errors.join('; '),
        });
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    event.target.value = '';
  }, [refreshUserProfiles, t]);

  // -- Render --

  if (editingProfile) {
    return (
      <RuntimePageShell maxWidth="3xl">
        <ProfileEditor
          initial={editingProfile}
          onSave={handleSaveProfile}
          onCancel={() => setEditingProfile(null)}
        />
      </RuntimePageShell>
    );
  }

  return (
    <RuntimePageShell maxWidth="5xl">
      <div className="space-y-6">
        {/* Header + toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.profiles.description', {
              defaultValue: 'Browse, create, and manage AI capability profiles. Apply a profile to configure all capabilities at once.',
            })}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity"
              onClick={handleCreate}
            >
              {t('runtimeConfig.profiles.create', { defaultValue: '+ Create Profile' })}
            </button>
            <button
              type="button"
              className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
              onClick={handleImportClick}
            >
              {t('runtimeConfig.profiles.import', { defaultValue: 'Import' })}
            </button>
            {customEntries.length > 0 ? (
              <button
                type="button"
                className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
                onClick={handleExport}
              >
                {t('runtimeConfig.profiles.export', { defaultValue: 'Export' })}
              </button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>

        {/* Feedback */}
        {feedback ? (
          <div
            className={[
              'rounded-xl px-3 py-2 text-xs',
              feedback.type === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-red-200 bg-red-50 text-red-700',
            ].join(' ')}
          >
            {feedback.message}
            <button
              type="button"
              className="ml-2 opacity-60 hover:opacity-100"
              onClick={() => setFeedback(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* Loading */}
        {runtimeQuery.isPending ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-8 text-center text-xs text-gray-400">
            {t('runtimeConfig.profiles.loading', { defaultValue: 'Loading profiles...' })}
          </div>
        ) : null}

        {/* Recommended */}
        {recommendedEntries.length > 0 ? (
          <CatalogSection title={t('runtimeConfig.profiles.sectionRecommended', { defaultValue: 'Recommended' })}>
            {recommendedEntries.map((entry) => (
              <ProfileCard
                key={entry.profile.profileId}
                entry={entry}
                onApply={handleApply}
                onDuplicate={handleDuplicate}
                applying={applying}
              />
            ))}
          </CatalogSection>
        ) : null}

        {/* Built-in */}
        {builtinEntries.length > 0 ? (
          <CatalogSection title={t('runtimeConfig.profiles.sectionBuiltin', { defaultValue: 'Built-in' })}>
            {builtinEntries.map((entry) => (
              <ProfileCard
                key={entry.profile.profileId}
                entry={entry}
                onApply={handleApply}
                onDuplicate={handleDuplicate}
                applying={applying}
              />
            ))}
          </CatalogSection>
        ) : null}

        {/* Custom */}
        <CatalogSection title={t('runtimeConfig.profiles.sectionCustom', { defaultValue: 'Custom' })}>
          {customEntries.length > 0 ? (
            customEntries.map((entry) => (
              <ProfileCard
                key={entry.profile.profileId}
                entry={entry}
                onApply={handleApply}
                onEdit={(p) => setEditingProfile(structuredClone(p))}
                onDelete={handleDeleteProfile}
                onDuplicate={handleDuplicate}
                applying={applying}
              />
            ))
          ) : (
            <div className="col-span-full rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-8 text-center text-xs text-gray-400">
              {t('runtimeConfig.profiles.noCustom', {
                defaultValue: 'No custom profiles yet. Create one or import from a file.',
              })}
            </div>
          )}
        </CatalogSection>
      </div>
    </RuntimePageShell>
  );
}
