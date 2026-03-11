import { ModHubRow } from './mod-hub-row';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useTranslation } from 'react-i18next';
import type { ModHubPageModel } from './mod-hub-controller';

type ModHubViewProps = ModHubPageModel;

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ICON_BOX = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

export function ModHubView(model: ModHubViewProps) {
  const { t } = useTranslation();
  const installedMods = model.filteredMods.filter((mod) => mod.isInstalled);
  const notInstalledMods = model.filteredMods.filter((mod) => !mod.isInstalled);
  const pendingPathInstall = model.pendingAction?.modId === 'manual:path' && model.pendingAction.action === 'install-from-path';
  const pendingUrlInstall = model.pendingAction?.modId === 'manual:url' && model.pendingAction.action === 'install-from-url';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      <div className="shrink-0 bg-[#F0F4F8] px-6 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h1 className={APP_PAGE_TITLE_CLASS}>{t('ModHub.title')}</h1>
          </div>
          <div className="w-full max-w-xl lg:w-[420px] lg:flex-shrink-0">
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-emerald-500">
                {ICON_SEARCH}
              </span>
              <input
                type="text"
                className="w-full rounded-full border border-white/70 bg-white/85 py-2.5 pl-11 pr-5 text-sm text-gray-900 placeholder:text-gray-400 shadow-[0_10px_30px_rgba(15,23,42,0.06)] outline-none backdrop-blur-xl transition-all focus:border-emerald-200 focus:bg-white focus:shadow-[0_14px_36px_rgba(16,185,129,0.10)] focus:ring-4 focus:ring-emerald-100/70"
                placeholder={t('ModHub.searchPlaceholder')}
                value={model.searchQuery}
                onChange={(event) => model.onSearchQueryChange(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 bg-[#F0F4F8] px-6 pb-3 pt-1 text-xs font-semibold text-gray-500">
        {t('ModHub.resultsCount', { count: model.filteredMods.length })}
        {installedMods.length > 0 && (
          <span className="ml-2 font-normal text-mint-600">
            {t('ModHub.installedCount', { count: installedMods.length })}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
        <section className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('ModHub.installFromPathTitle')}</p>
              <p className="mt-1 text-xs text-gray-500">
                {t('ModHub.installFromPathDescription')}
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                type="text"
                className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-200 focus:bg-white"
                placeholder={t('ModHub.installFromPathPlaceholder')}
                value={model.pathSource}
                onChange={(event) => model.onPathSourceChange(event.target.value)}
              />
              <button
                type="button"
                onClick={model.onInstallFromPath}
                disabled={pendingPathInstall}
                className="rounded-full bg-mint-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-mint-600 disabled:opacity-60"
              >
                {pendingPathInstall ? t('ModHub.installing') : t('ModHub.installFromPathAction')}
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('ModHub.installFromUrlTitle')}</p>
              <p className="mt-1 text-xs text-gray-500">
                {t('ModHub.installFromUrlDescription')}
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                type="url"
                className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-200 focus:bg-white"
                placeholder={t('ModHub.installFromUrlPlaceholder')}
                value={model.urlSource}
                onChange={(event) => model.onUrlSourceChange(event.target.value)}
              />
              <button
                type="button"
                onClick={model.onInstallFromUrl}
                disabled={pendingUrlInstall}
                className="rounded-full bg-mint-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-mint-600 disabled:opacity-60"
              >
                {pendingUrlInstall ? t('ModHub.installing') : t('ModHub.installFromUrlAction')}
              </button>
            </div>
          </div>
        </section>

        {installedMods.length > 0 && (
          <section>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t('ModHub.installedSection', { count: installedMods.length })}
            </div>
            <div className="space-y-2">
              {installedMods.map((mod) => (
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
                  onOpenModSettings={model.onOpenModSettings}
                  onSelectMod={model.onSelectMod}
                />
              ))}
            </div>
          </section>
        )}

        {notInstalledMods.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-500">
              {ICON_BOX}
              {t('ModHub.availableSection', { count: notInstalledMods.length })}
            </div>
            <div className="space-y-2">
              {notInstalledMods.map((mod) => (
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
                  onOpenModSettings={model.onOpenModSettings}
                  onSelectMod={model.onSelectMod}
                />
              ))}
            </div>
          </section>
        )}
        
        {model.filteredMods.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl bg-gray-50 text-sm text-gray-500">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-gray-300">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            {t('ModHub.noSearchResults')}
          </div>
        )}
      </div>
    </div>
  );
}
