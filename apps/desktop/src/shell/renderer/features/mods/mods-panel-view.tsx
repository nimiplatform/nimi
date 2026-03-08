import { useTranslation } from 'react-i18next';
import type { ModsPanelModel, ModsPanelMod } from './mods-panel-controller';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ICON_SETTINGS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ICON_EXTERNAL = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 5h5v5" />
    <path d="M10 14 19 5" />
    <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
  </svg>
);

const ICON_POWER = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v10" />
    <path d="M18.4 5.6a9 9 0 1 1-12.8 0" />
  </svg>
);

const ICON_TRASH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ICON_RETRY = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

function ModCard({
  mod,
  pendingModId,
  onOpen,
  onEnable,
  onDisable,
  onUninstall,
  onRetry,
  onSettings,
}: {
  mod: ModsPanelMod;
  pendingModId: string | null;
  onOpen: (modId: string) => void;
  onEnable: (modId: string) => void;
  onDisable: (modId: string) => void;
  onUninstall: (modId: string) => void;
  onRetry: (modId: string) => void;
  onSettings: (modId: string) => void;
}) {
  const { t } = useTranslation();
  const isPending = pendingModId === mod.id;

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/50 bg-white/60 p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/80 hover:shadow-[0_8px_32px_rgba(78,204,163,0.12)]">
      <div className="flex flex-1 items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm transition-transform duration-300 group-hover:scale-105"
          style={{ background: mod.iconBg }}
        >
          {mod.iconText}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-800">{mod.name}</h3>
            <span className="shrink-0 text-[11px] text-slate-400 font-medium">{mod.version}</span>
            {mod.isCrashed ? (
              <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-500">
                {t('ModsPanel.crashed')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 leading-relaxed">{mod.description}</p>
        </div>
        
        {/* Settings icon - top right corner, only for enabled mods */}
        {!mod.isCrashed && mod.isEnabled && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onSettings(mod.id)}
            className="shrink-0 rounded-full p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            title={t('ModsPanel.settings')}
            aria-label={t('ModsPanel.settings')}
          >
            {ICON_SETTINGS}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {mod.isCrashed ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onRetry(mod.id)}
            className="rounded-full bg-red-400 px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-red-500 hover:shadow-md disabled:opacity-50 active:scale-95"
          >
            {t('ModsPanel.retry')}
          </button>
        ) : mod.isEnabled ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onOpen(mod.id)}
              className="rounded-full bg-[#4ECCA3] px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-[#3DBB94] hover:shadow-[0_4px_12px_rgba(78,204,163,0.35)] disabled:opacity-50 active:scale-95"
            >
              {t('ModsPanel.open')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onDisable(mod.id)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            >
              {t('ModsPanel.disable')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onEnable(mod.id)}
              className="rounded-full bg-[#4ECCA3] px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-[#3DBB94] hover:shadow-[0_4px_12px_rgba(78,204,163,0.35)] disabled:opacity-50 active:scale-95"
            >
              {t('ModsPanel.enable')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onUninstall(mod.id)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            >
              {t('ModsPanel.uninstall')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ModsPanelView(props: ModsPanelModel) {
  const { t } = useTranslation();
  const {
    searchQuery,
    enabledMods,
    disabledMods,
    pendingModId,
    onSearchQueryChange,
    onOpenMod,
    onEnableMod,
    onDisableMod,
    onUninstallMod,
    onRetryMod,
    onOpenModSettings,
    onOpenMarketplace,
  } = props;

  const hasMods = enabledMods.length > 0 || disabledMods.length > 0;
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-br from-slate-50 to-[#f0faf6]">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">{t('ModsPanel.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('ModsPanel.subtitle')}</p>
          </div>

          <div className="w-full max-w-xl lg:w-[420px] lg:flex-shrink-0">
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#4ECCA3]">
                {ICON_SEARCH}
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder={t('ModsPanel.searchPlaceholder')}
                className="w-full rounded-full border border-white/70 bg-white/80 py-2.5 pl-11 pr-5 text-sm text-slate-800 placeholder:text-slate-400 shadow-[0_8px_24px_rgba(15,23,42,0.05)] outline-none backdrop-blur-xl transition-all focus:border-[#4ECCA3]/30 focus:bg-white focus:shadow-[0_12px_32px_rgba(78,204,163,0.15)] focus:ring-4 focus:ring-[#4ECCA3]/10"
              />
            </div>
          </div>
        </div>

        {!hasMods && !isSearching ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 shadow-inner">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.878-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.075.84-.505 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">{t('ModsPanel.noMods')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('ModsPanel.noModsHint')}</p>
            <button
              type="button"
              onClick={onOpenMarketplace}
              className="mt-5 rounded-full bg-[#4ECCA3] px-6 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_rgba(78,204,163,0.35)] transition-all hover:bg-[#3DBB94] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95"
            >
              {t('ModsPanel.openMarketplace')}
            </button>
          </div>
        ) : !hasMods && isSearching ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">{t('ModsPanel.noSearchResults')}</p>
          </div>
        ) : (
          <>
            {enabledMods.length > 0 ? (
              <section className="mb-10">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#4ECCA3]/10">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ECCA3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-700">{t('ModsPanel.enabledSection')}</h2>
                  <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{enabledMods.length}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {enabledMods.map((mod) => (
                    <ModCard
                      key={mod.id}
                      mod={mod}
                      pendingModId={pendingModId}
                      onOpen={onOpenMod}
                      onEnable={onEnableMod}
                      onDisable={onDisableMod}
                      onUninstall={onUninstallMod}
                      onRetry={onRetryMod}
                      onSettings={onOpenModSettings}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {disabledMods.length > 0 ? (
              <section className="mb-8">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-200/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-700">{t('ModsPanel.disabledSection')}</h2>
                  <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{disabledMods.length}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {disabledMods.map((mod) => (
                    <ModCard
                      key={mod.id}
                      mod={mod}
                      pendingModId={pendingModId}
                      onOpen={onOpenMod}
                      onEnable={onEnableMod}
                      onDisable={onDisableMod}
                      onUninstall={onUninstallMod}
                      onRetry={onRetryMod}
                      onSettings={onOpenModSettings}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
