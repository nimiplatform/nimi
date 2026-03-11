import { MarketplaceRow } from './marketplace-row';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import type { MarketplacePageModel } from './marketplace-controller';

type MarketplaceViewProps = MarketplacePageModel & {
  embedded?: boolean;
  onOpenLibrary?: () => void;
};

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

export function MarketplaceView(model: MarketplaceViewProps) {
  const embedded = Boolean(model.embedded);
  const onOpenLibrary = model.onOpenLibrary;
  // Separate installed and not installed mods
  const installedMods = model.filteredMods.filter((mod) => mod.isInstalled);
  const notInstalledMods = model.filteredMods.filter((mod) => !mod.isInstalled);
  const pendingPathInstall = model.pendingAction?.modId === 'manual:path' && model.pendingAction.action === 'install-from-path';
  const pendingUrlInstall = model.pendingAction?.modId === 'manual:url' && model.pendingAction.action === 'install-from-url';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      {/* Header */}
      <div className="shrink-0 bg-[#F0F4F8] px-6 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h1 className={APP_PAGE_TITLE_CLASS}>Mod Marketplace</h1>
            {embedded ? (
              <button
                type="button"
                onClick={onOpenLibrary}
                className="rounded-full border border-mint-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-mint-300 hover:bg-white hover:text-slate-900"
              >
                Back to Library
              </button>
            ) : null}
          </div>
          <div className="w-full max-w-xl lg:w-[420px] lg:flex-shrink-0">
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-emerald-500">
                {ICON_SEARCH}
              </span>
              <input
                type="text"
                className="w-full rounded-full border border-white/70 bg-white/85 py-2.5 pl-11 pr-5 text-sm text-gray-900 placeholder:text-gray-400 shadow-[0_10px_30px_rgba(15,23,42,0.06)] outline-none backdrop-blur-xl transition-all focus:border-emerald-200 focus:bg-white focus:shadow-[0_14px_36px_rgba(16,185,129,0.10)] focus:ring-4 focus:ring-emerald-100/70"
                placeholder="Search mods..."
                value={model.searchQuery}
                onChange={(event) => model.onSearchQueryChange(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="shrink-0 bg-[#F0F4F8] px-6 pb-3 pt-1 text-xs font-semibold text-gray-500">
        {model.filteredMods.length} mods found
        {installedMods.length > 0 && (
          <span className="ml-2 font-normal text-mint-600">({installedMods.length} installed)</span>
        )}
      </div>

      {/* Content Area with padding */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
        <section className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Install from local package</p>
              <p className="mt-1 text-xs text-gray-500">
                Enter a prebuilt mod folder path or `.zip` package path under your local filesystem.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                type="text"
                className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-200 focus:bg-white"
                placeholder="/absolute/path/to/mod or /absolute/path/to/mod.zip"
                value={model.pathSource}
                onChange={(event) => model.onPathSourceChange(event.target.value)}
              />
              <button
                type="button"
                onClick={model.onInstallFromPath}
                disabled={pendingPathInstall}
                className="rounded-full bg-mint-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-mint-600 disabled:opacity-60"
              >
                {pendingPathInstall ? 'Installing...' : 'Install from path'}
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Install from URL</p>
              <p className="mt-1 text-xs text-gray-500">
                Remote install only accepts prebuilt `.zip` mod packages.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                type="url"
                className="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-emerald-200 focus:bg-white"
                placeholder="https://example.com/my-mod.zip"
                value={model.urlSource}
                onChange={(event) => model.onUrlSourceChange(event.target.value)}
              />
              <button
                type="button"
                onClick={model.onInstallFromUrl}
                disabled={pendingUrlInstall}
                className="rounded-full bg-mint-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-mint-600 disabled:opacity-60"
              >
                {pendingUrlInstall ? 'Installing...' : 'Install from URL'}
              </button>
            </div>
          </div>
        </section>

        {/* Installed Section */}
        {installedMods.length > 0 && (
          <section>
            <div className="space-y-2">
              {installedMods.map((mod) => (
                <MarketplaceRow
                  key={mod.id}
                  mod={mod}
                  pendingAction={model.pendingAction}
                  isSelected={model.selectedModId === mod.id}
                  onOpenMod={model.onOpenMod}
                  onInstallMod={model.onInstallMod}
                  onUninstallMod={model.onUninstallMod}
                  onEnableMod={model.onEnableMod}
                  onDisableMod={model.onDisableMod}
                  onOpenModSettings={model.onOpenModSettings}
                  onSelectMod={model.onSelectMod}
                />
              ))}
            </div>
          </section>
        )}

        {/* Available Section */}
        {notInstalledMods.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-500">
              {ICON_BOX}
              Available ({notInstalledMods.length})
            </div>
            <div className="space-y-2">
              {notInstalledMods.map((mod) => (
                <MarketplaceRow
                  key={mod.id}
                  mod={mod}
                  pendingAction={model.pendingAction}
                  isSelected={model.selectedModId === mod.id}
                  onOpenMod={model.onOpenMod}
                  onInstallMod={model.onInstallMod}
                  onUninstallMod={model.onUninstallMod}
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
            No installed mods match your search
          </div>
        )}
      </div>
    </div>
  );
}
