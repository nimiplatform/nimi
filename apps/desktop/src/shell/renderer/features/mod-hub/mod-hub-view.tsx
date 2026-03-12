import { useEffect, useRef } from 'react';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useTranslation } from 'react-i18next';
import { ModHubRow } from './mod-hub-row';
import type { ModHubPageModel } from './mod-hub-controller';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ICON_FOLDER = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ICON_BOX = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

function DockTile({
  modName,
  iconText,
  iconBg,
  accentClassName,
  onClick,
}: {
  modName: string;
  iconText: string;
  iconBg: string;
  accentClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col items-center gap-3 rounded-[28px] border border-white/65 bg-white/78 px-4 py-5 text-center shadow-[0_18px_48px_rgba(120,113,108,0.10)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_24px_58px_rgba(16,185,129,0.14)]"
    >
      <div
        className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[26px] text-lg font-bold text-white shadow-[0_18px_28px_rgba(15,23,42,0.16)] transition group-hover:scale-[1.04]"
        style={{ background: iconBg }}
      >
        {iconText}
        <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[#f6f1e7] ${accentClassName}`} />
      </div>
      <span className="line-clamp-2 min-h-[2.75rem] text-sm font-medium leading-5 text-stone-700">{modName}</span>
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasVisibleResults = model.managementSections.some((section) => section.mods.length > 0);

  useEffect(() => {
    if (!model.isSearchFocused) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      model.onSearchBlur();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      model.onSearchBlur();
      inputRef.current?.blur();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model.isSearchFocused, model.onSearchBlur]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_30%),linear-gradient(180deg,#f8f3e8_0%,#f4efe3_38%,#efe7d7_100%)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div ref={rootRef} className="mx-auto flex w-full max-w-6xl flex-col">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className={`${APP_PAGE_TITLE_CLASS} text-stone-900`}>{t('ModHub.title')}</h1>
              <p className="mt-2 text-sm text-stone-500">{t('ModHub.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={model.onOpenModsFolder}
              disabled={!model.installedModsDir}
              className="inline-flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/80 px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-[0_12px_30px_rgba(120,113,108,0.10)] transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ICON_FOLDER}
              {t('ModHub.openModsFolder')}
            </button>
          </div>

          <div className="relative mt-10 flex justify-center">
            <div className="w-full max-w-2xl">
              <div className="group relative">
                <span className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-stone-400 transition group-focus-within:text-emerald-600">
                  {ICON_SEARCH}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  className="h-16 w-full rounded-full border border-white/80 bg-white/86 py-3 pl-14 pr-6 text-base text-stone-900 shadow-[0_22px_56px_rgba(120,113,108,0.12)] outline-none backdrop-blur-xl transition focus:border-emerald-200 focus:shadow-[0_28px_64px_rgba(16,185,129,0.16)]"
                  placeholder={t('ModHub.searchPlaceholder')}
                  value={model.searchQuery}
                  onFocus={model.onSearchFocus}
                  onChange={(event) => model.onSearchQueryChange(event.target.value)}
                />
              </div>
              <div className="mt-3 flex items-center justify-center gap-3 text-xs text-stone-500">
                <span>{t('ModHub.manageResults', { count: model.visibleModCount })}</span>
                <span>{t('ModHub.installedDock', { count: model.installedModsCount })}</span>
              </div>
            </div>
          </div>

          <div className={`mt-10 transition duration-200 ${model.isSearchFocused ? 'scale-[0.985] opacity-35 blur-[1px]' : 'opacity-100'}`}>
            {model.dockMods.length > 0 ? (
              <>
                <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {ICON_BOX}
                  {t('ModHub.installedDockSection')}
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {model.dockMods.map((mod) => (
                    <DockTile
                      key={mod.id}
                      modName={mod.name}
                      iconText={mod.iconText}
                      iconBg={mod.iconBg}
                      accentClassName={dockAccentClass(mod.visualState)}
                      onClick={() => model.onActivateDockMod(mod.id)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-[32px] border border-white/70 bg-white/70 px-8 py-12 text-center text-sm text-stone-500 shadow-[0_18px_48px_rgba(120,113,108,0.08)]">
                {t('ModHub.emptyDock')}
              </div>
            )}
          </div>

          {model.isSearchFocused ? (
            <div className="relative z-20 mx-auto mt-8 w-full max-w-5xl">
              <div className="overflow-hidden rounded-[34px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(250,249,246,0.92))] p-5 shadow-[0_30px_90px_rgba(87,83,78,0.18)] backdrop-blur-2xl lg:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">{t('ModHub.managePanelTitle')}</p>
                    <p className="mt-1 text-xs text-stone-500">{t('ModHub.managePanelDescription')}</p>
                  </div>
                </div>

                <div className="space-y-6">
                  {model.managementSections.map((section) => {
                    if (section.mods.length === 0) return null;
                    const title = section.key === 'installed'
                      ? t('ModHub.installedSection', { count: section.mods.length })
                      : t('ModHub.availableSection', { count: section.mods.length });
                    return (
                      <section key={section.key}>
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                          {title}
                        </div>
                        <div className="space-y-3">
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

                  {!hasVisibleResults ? (
                    <div className="rounded-[28px] border border-dashed border-stone-200 bg-white/60 px-8 py-12 text-center text-sm text-stone-500">
                      {t('ModHub.noSearchResults')}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
