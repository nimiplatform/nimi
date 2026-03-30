import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { ModHubRow } from './mod-hub-row';
import type { ModHubPageModel } from './mod-hub-controller';

const ICON_SEARCH = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ICON_FOLDER = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ICON_SETTINGS = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function DockTile({
  modName,
  iconText,
  iconImageSrc,
  iconBg,
  accentClassName,
  onClick,
}: {
  modName: string;
  iconText: string;
  iconImageSrc?: string;
  iconBg: string;
  accentClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-3 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:scale-95"
    >
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl text-sm font-bold text-white transition-all duration-200 group-hover:scale-110 ${
          iconImageSrc ? '' : 'shadow-sm group-hover:shadow-md'
        }`}
        style={{ background: iconImageSrc ? 'transparent' : iconBg }}
      >
        {iconImageSrc ? (
          <img
            src={iconImageSrc}
            alt={`${modName} logo`}
            className="h-full w-full object-contain"
          />
        ) : (
          iconText
        )}
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-[#F5F5F7] ${accentClassName}`} />
      </div>
      <span className="line-clamp-2 max-w-[84px] text-center text-[12px] font-medium leading-tight text-gray-700 transition-colors group-hover:text-gray-900">
        {modName}
      </span>
    </button>
  );
}

function dockAccentClass(visualState: string): string {
  switch (visualState) {
    case 'enabled':
      return 'bg-emerald-500';
    case 'update-available':
      return 'bg-sky-500';
    case 'failed':
      return 'bg-rose-500';
    case 'conflict':
      return 'bg-amber-500';
    case 'disabled':
      return 'bg-stone-400';
    default:
      return 'bg-stone-300';
  }
}

function ModHubSkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/90 ${className}`} />;
}

export function ModHubView(model: ModHubPageModel) {
  const { t } = useTranslation();
  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasVisibleResults = model.managementSections.some((section) => section.mods.length > 0);
  const showDock = !model.isSearchFocused && !model.searchQuery.trim();

  useEffect(() => {
    if (!model.isSearchFocused) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchBarRef.current) return;
      if (searchBarRef.current.contains(event.target as Node)) return;
      model.onSearchBlur();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      model.onSearchBlur();
      model.onSearchQueryChange('');
      inputRef.current?.blur();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model.isSearchFocused, model.onSearchBlur, model.onSearchQueryChange]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [settingsOpen]);

  if (model.loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--nimi-sidebar-canvas)]">
        <div className="z-10 shrink-0 bg-[var(--nimi-sidebar-canvas)]/95 px-8 py-8 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6">
            <ModHubSkeletonBlock className="h-10 w-40 rounded-xl" />
            <div className="flex items-center gap-3">
              <ModHubSkeletonBlock className="h-11 w-80 rounded-full" />
              <ModHubSkeletonBlock className="h-11 w-11" />
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" contentClassName="mx-auto max-w-6xl space-y-12 px-8 pb-10">
            <section>
              <ModHubSkeletonBlock className="mb-6 h-4 w-28 rounded-lg" />
              <div className="grid grid-cols-4 gap-x-4 gap-y-8 md:grid-cols-6 lg:grid-cols-8">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div key={index} className="flex flex-col items-center gap-3">
                    <ModHubSkeletonBlock className="h-16 w-16 rounded-2xl" />
                    <ModHubSkeletonBlock className="h-3 w-16 rounded" />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-6 border-b border-gray-50 pb-4">
                <ModHubSkeletonBlock className="h-7 w-48 rounded-xl" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-4">
                        <ModHubSkeletonBlock className="h-12 w-12 rounded-xl" />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <ModHubSkeletonBlock className="h-5 w-28 rounded" />
                            <ModHubSkeletonBlock className="h-5 w-12 rounded-full" />
                            <ModHubSkeletonBlock className="h-5 w-16 rounded-full" />
                          </div>
                          <ModHubSkeletonBlock className="h-4 w-3/4 rounded" />
                          <div className="flex gap-2">
                            <ModHubSkeletonBlock className="h-5 w-20 rounded-md" />
                            <ModHubSkeletonBlock className="h-5 w-24 rounded-md" />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <ModHubSkeletonBlock className="h-9 w-9 rounded-full" />
                        <ModHubSkeletonBlock className="h-6 w-11 rounded-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--nimi-sidebar-canvas)]">
      <div className="z-10 shrink-0 bg-[var(--nimi-sidebar-canvas)]/95 px-8 py-8 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6">
          <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>{t('ModHub.title')}</h1>
          <div className="flex items-center gap-3">
            <div ref={searchBarRef} className="relative w-80">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {ICON_SEARCH}
              </span>
              <input
                ref={inputRef}
                type="text"
                className="h-11 w-full rounded-full border border-gray-200 bg-white pl-10 pr-4 text-sm text-gray-900 shadow-sm outline-none transition-shadow placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-green-400"
                placeholder={t('ModHub.searchPlaceholder')}
                value={model.searchQuery}
                onFocus={model.onSearchFocus}
                onChange={(event) => model.onSearchQueryChange(event.target.value)}
              />
            </div>
            <div ref={settingsRef} className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((prev) => !prev)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:text-gray-600"
                aria-label={t('ModHub.moreActions')}
              >
                {ICON_SETTINGS}
              </button>
              {settingsOpen ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1 shadow-[0_12px_32px_rgba(15,23,42,0.10)]">
                  <div className="px-3.5 py-2 text-[11px] tabular-nums text-gray-400">
                    {t('ModHub.installedDock', { count: model.installedModsCount })}
                  </div>
                  <div className="mx-2 border-t border-gray-100" />
                  <button
                    type="button"
                    onClick={() => {
                      model.onOpenModsFolder();
                      setSettingsOpen(false);
                    }}
                    disabled={!model.installedModsDir}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    {ICON_FOLDER}
                    {t('ModHub.openModsFolder')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" contentClassName="mx-auto max-w-6xl space-y-12 px-8 pb-10">
          <div
            className={`transition-all duration-300 ease-in-out ${
              showDock ? 'opacity-100' : 'pointer-events-none h-0 overflow-hidden opacity-0'
            }`}
          >
            <div>
              {model.dockMods.length > 0 ? (
                <section>
                  <div className="mb-6 px-2 text-sm font-medium uppercase tracking-[0.16em] text-gray-500">
                    {t('ModHub.installedDockSection')}
                  </div>
                  <div className="grid grid-cols-4 gap-x-4 gap-y-8 md:grid-cols-6 lg:grid-cols-8">
                    {model.dockMods.map((mod) => (
                      <DockTile
                        key={mod.id}
                        modName={mod.name}
                        iconText={mod.iconText}
                        iconImageSrc={mod.iconImageSrc}
                        iconBg={mod.iconBg}
                        accentClassName={dockAccentClass(mod.visualState)}
                        onClick={() => model.onActivateDockMod(mod.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-400">
                  {t('ModHub.emptyDock')}
                </div>
              )}
            </div>
          </div>

          {model.managementSections.map((section) => {
            if (section.mods.length === 0) return null;
            const isInstalledSection = section.key === 'installed';
            return (
              <section key={section.key} className="rounded-[28px] border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between border-b border-gray-50 pb-4">
                  <h2 className="text-lg font-semibold text-gray-800">
                    {isInstalledSection
                      ? t('ModHub.installedSection', { count: section.mods.length })
                      : t('ModHub.availableSection', { count: section.mods.length })}
                  </h2>
                </div>
                <div className="space-y-2">
                  {section.mods.map((mod) => (
                    <ModHubRow
                      key={mod.id}
                      mod={mod}
                      pendingAction={model.pendingAction}
                      isSelected={model.selectedModId === mod.id}
                      onOpenMod={model.onOpenMod}
                      onInstallMod={model.onInstallMod}
                      onUninstallMod={model.onUninstallMod}
                      onUpdateMod={model.onUpdateMod}
                      onEnableMod={model.onEnableMod}
                      onDisableMod={model.onDisableMod}
                      onRetryMod={model.onRetryMod}
                      onOpenModFolder={model.onOpenModFolder}
                      onOpenModSettings={model.onOpenModSettings}
                      onSelectMod={model.onSelectMod}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!hasVisibleResults && (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-400">
              {t('ModHub.noSearchResults')}
            </div>
          )}
      </ScrollArea>
    </div>
  );
}
