import { Tooltip } from '@renderer/components/tooltip.js';
import { useTranslation } from 'react-i18next';
import type { ModsPanelModel, ModsPanelMod } from './mods-panel-controller';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

function buildTooltipContent(mod: ModsPanelMod, t: (key: string) => string): string {
  const lines = [mod.description];
  if (mod.sourceType === 'dev') {
    lines.push(t('ModsPanel.devTooltip'));
  }
  return lines.filter(Boolean).join('\n');
}

function ModLauncherTile({
  mod,
  onOpen,
  t,
}: {
  mod: ModsPanelMod;
  onOpen: (modId: string) => void;
  t: (key: string) => string;
}) {
  return (
    <Tooltip
      content={buildTooltipContent(mod, t)}
      placement="bottom"
      multiline
      contentClassName="max-w-72 bg-slate-900/95 px-3 py-2 text-left text-[11px] leading-relaxed text-white"
      className="h-full w-full"
    >
      <button
        type="button"
        onClick={() => onOpen(mod.id)}
        className="group relative flex w-full flex-col items-center gap-3 rounded-[1.4rem] border border-white/60 bg-white/75 px-4 py-5 text-center shadow-[0_10px_32px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-[#4ECCA3]/30 hover:bg-white hover:shadow-[0_16px_40px_rgba(78,204,163,0.16)]"
      >
        {mod.sourceType === 'dev' ? (
          <span className="absolute right-3 top-3 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('ModsPanel.devBadge')}
          </span>
        ) : null}
        <div
          className="flex h-16 w-16 items-center justify-center rounded-[1.15rem] text-base font-bold text-white shadow-[0_10px_22px_rgba(15,23,42,0.14)] transition-transform duration-300 group-hover:scale-105"
          style={{ background: mod.iconBg }}
        >
          {mod.iconText}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800">{mod.name}</div>
        </div>
      </button>
    </Tooltip>
  );
}

export function ModsPanelView(props: ModsPanelModel) {
  const { t } = useTranslation();
  const {
    searchQuery,
    enabledMods,
    disabledMods,
    onSearchQueryChange,
    onOpenMod,
    onOpenMarketplace,
  } = props;

  const launchableMods = enabledMods.filter((mod) => mod.status === 'loaded');
  const hasInstalledMods = launchableMods.length > 0 || disabledMods.length > 0;
  const isSearching = searchQuery.trim().length > 0;
  const showEmptyEnabledState = !isSearching && launchableMods.length === 0 && disabledMods.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(78,204,163,0.16),_transparent_32%),linear-gradient(135deg,#f7fbfa_0%,#eef7f4_52%,#f8fbfd_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">{t('ModsPanel.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('ModsPanel.subtitle')}</p>
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
            <div className="w-full max-w-xl lg:w-[360px]">
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
            <button
              type="button"
              onClick={onOpenMarketplace}
              className="shrink-0 rounded-full border border-[#4ECCA3]/20 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all hover:border-[#4ECCA3]/35 hover:bg-white hover:text-slate-900"
            >
              {t('ModsPanel.openMarketplace')}
            </button>
          </div>
        </div>

        {!hasInstalledMods && !isSearching ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 shadow-inner">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.878-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.075.84-.505 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">{t('ModsPanel.noMods')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('ModsPanel.noModsHint')}</p>
          </div>
        ) : showEmptyEnabledState ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 shadow-inner">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">{t('ModsPanel.noEnabledMods')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('ModsPanel.noEnabledModsHint')}</p>
          </div>
        ) : launchableMods.length === 0 && isSearching ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">{t('ModsPanel.noSearchResults')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {launchableMods.map((mod) => (
              <ModLauncherTile
                key={mod.id}
                mod={mod}
                onOpen={onOpenMod}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
