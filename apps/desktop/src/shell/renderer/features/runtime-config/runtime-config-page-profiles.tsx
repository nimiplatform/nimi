/**
 * AI Profile Catalog page — Linear/Stripe-inspired minimal UI.
 *
 * Single flat grid with active/idle card states and a ghost card for creation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { AIProfile } from '@nimiplatform/sdk/mod';
import { cn } from '@nimiplatform/nimi-kit/ui';
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
// Capability summary badges
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
          className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card dropdown (kebab menu)
// ---------------------------------------------------------------------------

const ELLIPSIS_ICON = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" />
  </svg>
);

function CardDropdown(props: {
  items: Array<{ label: string; danger?: boolean; onClick: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (props.items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      >
        {ELLIPSIS_ICON}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-xl bg-white py-1 shadow-lg ring-1 ring-gray-900/5">
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors',
                item.danger
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileCard — active / idle states
// ---------------------------------------------------------------------------

function ProfileCard(props: {
  entry: CatalogProfile;
  isActive: boolean;
  onApply: (profileId: string) => void;
  onEdit?: (profile: AIProfile) => void;
  onDelete?: (profileId: string) => void;
  onDuplicate: (profile: AIProfile) => void;
  applying: boolean;
}) {
  const { t } = useTranslation();
  const { profile, origin, recommended } = props.entry;
  const { isActive } = props;

  // Build dropdown menu — Apply is now inside the "..." menu for idle cards
  const menuItems: Array<{ label: string; danger?: boolean; onClick: () => void }> = [];
  if (!isActive) {
    menuItems.push({
      label: t('runtimeConfig.profiles.applyAction', { defaultValue: 'Apply' }),
      onClick: () => props.onApply(profile.profileId),
    });
  }
  menuItems.push({
    label: t('runtimeConfig.profiles.duplicate', { defaultValue: 'Duplicate' }),
    onClick: () => props.onDuplicate(profile),
  });
  if (origin === 'custom' && props.onEdit) {
    menuItems.push({
      label: t('runtimeConfig.profiles.edit', { defaultValue: 'Edit' }),
      onClick: () => props.onEdit!(profile),
    });
  }
  if (origin === 'custom' && props.onDelete) {
    menuItems.push({
      label: t('runtimeConfig.profiles.delete', { defaultValue: 'Delete' }),
      danger: true,
      onClick: () => props.onDelete!(profile.profileId),
    });
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl bg-white p-6 transition-all duration-200',
        isActive
          ? 'shadow-sm ring-2 ring-mint-500'
          : 'shadow-sm ring-1 ring-gray-900/5 hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      {/* Title row: name + status dot | "..." menu */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-gray-900">
            {profile.title || profile.profileId}
          </h4>
          {isActive ? (
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          ) : null}
        </div>

        {/* "..." always present, quiet */}
        <div className="shrink-0">
          <CardDropdown items={menuItems} />
        </div>
      </div>

      {/* Description */}
      {profile.description ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500">
          {profile.description}
        </p>
      ) : null}

      {/* Tags + Capability badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {recommended ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
            {t('runtimeConfig.profiles.recommended', { defaultValue: 'Recommended' })}
          </span>
        ) : null}
        {origin === 'custom' ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
            {t('runtimeConfig.profiles.custom', { defaultValue: 'Custom' })}
          </span>
        ) : null}
        {profile.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
            {tag}
          </span>
        ))}
        <CapabilitySummary capabilities={profile.capabilities} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GhostCard — create new profile
// ---------------------------------------------------------------------------

function GhostCard(props: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 bg-transparent p-6 text-gray-400 transition-all duration-200 hover:border-mint-300 hover:bg-mint-50/30 hover:text-mint-600"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span className="text-sm font-medium">{props.label}</span>
    </button>
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
  const profileOrigin = useAppStore((state) => state.aiConfig.profileOrigin);
  const activeProfileId = profileOrigin?.profileId ?? null;
  const surface = useMemo(() => getDesktopAIConfigService(), []);

  // Merge all entries into a flat list
  const catalogEntries = useMemo((): CatalogProfile[] => {
    const entries: CatalogProfile[] = [];
    for (const p of runtimeQuery.data || []) {
      entries.push({ profile: p, origin: 'builtin', recommended: false });
    }
    for (const p of userProfiles) {
      entries.push({ profile: p, origin: 'custom', recommended: false });
    }
    return entries;
  }, [runtimeQuery.data, userProfiles]);

  const customEntries = catalogEntries.filter((e) => e.origin === 'custom');

  // -- Actions (unchanged) --

  const refreshUserProfiles = useCallback(() => {
    setUserVersion((v) => v + 1);
  }, []);

  const handleApply = useCallback(async (profileId: string) => {
    setApplying(true);
    setFeedback(null);
    try {
      const result = await surface.aiProfile.apply(scopeRef, profileId);
      if (result.success) {
        setFeedback({ type: 'success', message: t('runtimeConfig.profiles.applySuccess', { defaultValue: 'Profile applied successfully.' }) });
      } else {
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
        setFeedback({ type: 'error', message: result.errors.join('; ') });
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [refreshUserProfiles, t]);

  // -- Render --

  if (editingProfile) {
    return (
      <RuntimePageShell>
        <ProfileEditor
          initial={editingProfile}
          onSave={handleSaveProfile}
          onCancel={() => setEditingProfile(null)}
        />
      </RuntimePageShell>
    );
  }

  return (
    <RuntimePageShell>
      {/* ── Header: subtitle | Import / Export ── */}
      <section className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {t('runtimeConfig.profiles.subtitle', { defaultValue: 'Apply a profile to configure all capabilities at once.' })}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleImportClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.97]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t('runtimeConfig.profiles.import', { defaultValue: 'Import' })}
          </button>
          {customEntries.length > 0 ? (
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.97]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('runtimeConfig.profiles.export', { defaultValue: 'Export' })}
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </section>

      {/* ── Feedback banner ── */}
      {feedback ? (
        <div
          className={cn(
            'rounded-xl px-4 py-2.5 text-xs ring-1',
            feedback.type === 'success'
              ? 'bg-green-50 text-green-700 ring-green-200'
              : 'bg-red-50 text-red-700 ring-red-200',
          )}
        >
          {feedback.message}
          <button
            type="button"
            className="ml-2 opacity-60 hover:opacity-100"
            onClick={() => setFeedback(null)}
          >
            {t('runtimeConfig.profiles.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {runtimeQuery.isPending ? (
        <div className="rounded-xl bg-gray-50 px-4 py-12 text-center text-xs text-gray-400">
          {t('runtimeConfig.profiles.loading', { defaultValue: 'Loading profiles...' })}
        </div>
      ) : null}

      {/* ── Flat grid: all profiles + ghost card ── */}
      {!runtimeQuery.isPending ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {catalogEntries.map((entry) => (
            <ProfileCard
              key={entry.profile.profileId}
              entry={entry}
              isActive={entry.profile.profileId === activeProfileId}
              onApply={handleApply}
              onEdit={entry.origin === 'custom' ? (p) => setEditingProfile(structuredClone(p)) : undefined}
              onDelete={entry.origin === 'custom' ? handleDeleteProfile : undefined}
              onDuplicate={handleDuplicate}
              applying={applying}
            />
          ))}
          <GhostCard
            onClick={handleCreate}
            label={t('runtimeConfig.profiles.createCard', { defaultValue: 'Create Profile' })}
          />
        </div>
      ) : null}
    </RuntimePageShell>
  );
}
