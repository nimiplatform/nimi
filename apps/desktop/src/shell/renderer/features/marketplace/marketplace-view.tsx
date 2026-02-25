import { MarketplaceRow } from './marketplace-row';
import type { MarketplacePageModel } from './marketplace-controller';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ICON_FILTER = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export function MarketplaceView(model: MarketplacePageModel) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-6">
        <h1 className="text-lg font-semibold text-gray-900">Mod Marketplace</h1>
      </div>

      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {ICON_SEARCH}
            </span>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pr-3 pl-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-300 focus:bg-white"
              placeholder="Search mods..."
              value={model.searchQuery}
              onChange={(event) => model.onSearchQueryChange(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {ICON_FILTER}
            Filters
          </button>
        </div>
      </div>

      <div className="shrink-0 px-6 py-2.5 text-xs text-gray-500">
        {model.filteredMods.length} mods found
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {model.filteredMods.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-gray-500">
            No mods match your search
          </div>
        ) : (
          model.filteredMods.map((mod) => (
            <MarketplaceRow
              key={mod.id}
              mod={mod}
              pendingAction={model.pendingAction}
              onOpenMod={model.onOpenMod}
              onInstallMod={model.onInstallMod}
              onUninstallMod={model.onUninstallMod}
              onEnableMod={model.onEnableMod}
              onDisableMod={model.onDisableMod}
              onOpenModSettings={model.onOpenModSettings}
            />
          ))
        )}
      </div>
    </div>
  );
}
