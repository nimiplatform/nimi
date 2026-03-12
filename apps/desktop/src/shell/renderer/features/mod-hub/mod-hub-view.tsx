import { useEffect, useRef, useState } from 'react';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
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
      className="group flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 transition-transform hover:scale-105 active:scale-95"
    >
      <div
        className="relative flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-[13px] text-sm font-bold text-white shadow-[0_3px_10px_rgba(0,0,0,0.15)] transition-shadow group-hover:shadow-[0_6px_20px_rgba(0,0,0,0.22)]"
        style={{ background: iconBg }}
      >
        {iconImageSrc ? (
          <img
            src={iconImageSrc}
            alt={`${modName} logo`}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          iconText
        )}
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-[#f7f5f0] ${accentClassName}`} />
      </div>
      <span className="line-clamp-1 max-w-[72px] text-center text-[11px] leading-tight text-stone-500 transition-colors group-hover:text-stone-800">
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f5f0]">
      {/* Header */}
      <div className="z-10 shrink-0 border-b border-stone-200/60 bg-[#f7f5f0]/95 px-6 py-2.5 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className={APP_PAGE_TITLE_CLASS}>{t('ModHub.title')}</h1>
          <div className="flex items-center gap-2.5">
            {/* Search bar */}
            <div ref={searchBarRef} className="relative w-[280px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
                {ICON_SEARCH}
              </span>
              <input
                ref={inputRef}
                type="text"
                className="h-9 w-full rounded-md border border-stone-200/80 bg-white/90 pl-9 pr-4 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
                placeholder={t('ModHub.searchPlaceholder')}
                value={model.searchQuery}
                onFocus={model.onSearchFocus}
                onChange={(event) => model.onSearchQueryChange(event.target.value)}
              />
            </div>
            {/* Settings dropdown */}
            <div ref={settingsRef} className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((prev) => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200/80 bg-white/80 text-stone-400 transition hover:bg-white hover:text-stone-600"
              >
                {ICON_SETTINGS}
              </button>
              {settingsOpen ? (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-stone-200/80 bg-white py-1 shadow-lg">
                  <div className="px-3.5 py-2 text-[11px] tabular-nums text-stone-400">
                    {t('ModHub.installedDock', { count: model.installedModsCount })}
                  </div>
                  <div className="mx-2 border-t border-stone-100" />
                  <button
                    type="button"
                    onClick={() => {
                      model.onOpenModsFolder();
                      setSettingsOpen(false);
                    }}
                    disabled={!model.installedModsDir}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40"
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

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-5">
          {/* Launchpad-style dock */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              showDock ? 'mb-6 max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            {model.dockMods.length > 0 ? (
              <div className="rounded-2xl bg-white/50 px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-sm">
                <div className="grid grid-cols-5 justify-items-center gap-x-1 gap-y-1 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-9">
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
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 px-6 py-8 text-center text-sm text-stone-400">
                {t('ModHub.emptyDock')}
              </div>
            )}
          </div>

          {/* Extension list sections */}
          {model.managementSections.map((section) => {
            if (section.mods.length === 0) return null;
            const title = section.key === 'installed'
              ? t('ModHub.installedSection', { count: section.mods.length })
              : t('ModHub.availableSection', { count: section.mods.length });
            return (
              <section key={section.key} className="mb-5">
                <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
                  {title}
                </div>
                <div className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200/70 bg-white">
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
                      onSelectMod={model.onSelectMod}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!hasVisibleResults && (
            <div className="rounded-xl border border-dashed border-stone-200 px-6 py-14 text-center text-sm text-stone-400">
              {t('ModHub.noSearchResults')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
