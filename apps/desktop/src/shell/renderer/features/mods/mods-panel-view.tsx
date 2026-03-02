import { useTranslation } from 'react-i18next';
import type { ModsPanelModel, ModsPanelMod } from './mods-panel-controller';

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
    <div className="rounded-2xl border border-white/60 bg-white/40 p-5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all hover:bg-white/60 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <div className="flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
          style={{ background: mod.iconBg }}
        >
          {mod.iconText}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900">{mod.name}</h3>
            <span className="shrink-0 text-[11px] text-gray-400">{mod.version}</span>
            {mod.isCrashed ? (
              <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                {t('ModsPanel.crashed')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">{mod.description}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {mod.isCrashed ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onRetry(mod.id)}
            className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          >
            {t('ModsPanel.retry')}
          </button>
        ) : mod.isEnabled ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onOpen(mod.id)}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {t('ModsPanel.open')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onSettings(mod.id)}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              {t('ModsPanel.settings')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onDisable(mod.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
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
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {t('ModsPanel.enable')}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onUninstall(mod.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F0F4F8]">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('ModsPanel.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('ModsPanel.subtitle')}</p>
        </div>

        <div className="mb-8 flex max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t('ModsPanel.searchPlaceholder')}
            className="w-full rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm outline-none transition-shadow focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        {!hasMods && !isSearching ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.878-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.075.84-.505 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700">{t('ModsPanel.noMods')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('ModsPanel.noModsHint')}</p>
            <button
              type="button"
              onClick={onOpenMarketplace}
              className="mt-4 rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
            >
              {t('ModsPanel.openMarketplace')}
            </button>
          </div>
        ) : !hasMods && isSearching ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-gray-500">{t('ModsPanel.noSearchResults')}</p>
          </div>
        ) : (
          <>
            {enabledMods.length > 0 ? (
              <section className="mb-8">
                <h2 className="mb-4 text-sm font-semibold text-gray-700">{t('ModsPanel.enabledSection')}</h2>
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
                <h2 className="mb-4 text-sm font-semibold text-gray-700">{t('ModsPanel.disabledSection')}</h2>
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
