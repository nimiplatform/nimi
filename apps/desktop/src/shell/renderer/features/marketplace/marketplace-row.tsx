import type {
  BadgeType,
  MarketplaceMod,
  MarketplacePendingActionType,
  MarketplaceRuntimeAction,
} from './marketplace-model';

const ICON_STAR = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ICON_CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ICON_PLUS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ICON_PLAY = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);



function ModBadge({ type }: { type: BadgeType }) {
  const styles: Record<BadgeType, { bg: string; color: string; label: string }> = {
    verified: { bg: 'bg-cyan-100', color: 'text-cyan-700', label: 'Verified' },
    catalog: { bg: 'bg-gray-100', color: 'text-gray-600', label: 'Catalog' },
  };
  const current = styles[type];

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${current.bg} ${current.color}`}>
      {current.label}
    </span>
  );
}

function StatusBadge({ isInstalled, isEnabled }: { isInstalled: boolean; isEnabled: boolean }) {
  // Only show badge for enabled mods
  if (!isInstalled) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
        Not installed
      </span>
    );
  }
  if (isEnabled) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
        Enabled
      </span>
    );
  }
  // Disabled mods show disabled badge
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      Disabled
    </span>
  );
}



export function MarketplaceRow({
  mod,
  pendingAction,
  isSelected,
  onOpenMod,
  onInstallMod,
  onUninstallMod: _onUninstallMod,
  onEnableMod,
  onDisableMod: _onDisableMod,
  onOpenModSettings: _onOpenModSettings,
  onSelectMod,
}: {
  mod: MarketplaceMod;
  pendingAction?: { modId: string; action: MarketplacePendingActionType } | null;
  isSelected?: boolean;
  onOpenMod?: ((modId: string) => void) | null;
  onInstallMod?: ((modId: string) => void) | null;
  onUninstallMod?: ((modId: string) => void) | null;
  onEnableMod?: ((modId: string) => void) | null;
  onDisableMod?: ((modId: string) => void) | null;
  onOpenModSettings?: ((modId: string) => void) | null;
  onSelectMod?: ((modId: string | null) => void) | null;
}) {
  const isActionLoading = (action: MarketplaceRuntimeAction) => (
    pendingAction?.modId === mod.id && pendingAction?.action === action
  );

  return (
    <div
      className={`
        group relative flex items-start gap-4 px-5 py-4 transition-all cursor-pointer 
        rounded-2xl border border-transparent bg-transparent
        hover:border-mint-200 hover:bg-mint-50/30
        ${isSelected ? 'border-mint-300 bg-mint-50 ring-1 ring-mint-200' : ''}
      `}
      onClick={() => onSelectMod?.(isSelected ? null : mod.id)}
    >
      {/* Icon */}
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm transition-transform group-hover:scale-105 mt-0.5"
        style={{ background: mod.iconBg }}
      >
        {mod.iconText}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-hidden max-w-[calc(100%-88px)]">
        {/* Title row with badges and version */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{mod.name}</span>
          <span className="text-[11px] text-gray-400 font-normal">{mod.version}</span>
          {mod.badge ? <ModBadge type={mod.badge} /> : null}
          <StatusBadge isInstalled={mod.isInstalled} isEnabled={mod.isEnabled} />
        </div>

        {/* Description - full text with wrapping */}
        <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-gray-500 line-clamp-2 break-words">
          {mod.description}
        </p>

        {/* Meta info row */}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
          <span>{mod.author}</span>
          {mod.rating && (
            <>
              <span className="text-gray-200">·</span>
              <span className="flex items-center gap-0.5 text-amber-500">{ICON_STAR}</span>
              <span>{mod.rating}</span>
              {mod.ratingCount && <span className="text-gray-300">({mod.ratingCount})</span>}
            </>
          )}
          {mod.installs && (
            <>
              <span className="text-gray-200">·</span>
              <span>{mod.installs} installs</span>
            </>
          )}
          {mod.updatedAgo && <span className="text-gray-300">· {mod.updatedAgo}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {!mod.isInstalled ? (
          // Not installed - show install button (solid, primary action)
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstallMod?.(mod.id);
            }}
            disabled={isActionLoading('install')}
            className="flex items-center gap-1.5 rounded-full bg-mint-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md active:scale-95 disabled:opacity-60"
          >
            {isActionLoading('install') ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              ICON_PLUS
            )}
            Install
          </button>
        ) : mod.isEnabled ? (
          // Enabled - show Open button (solid, smaller size)
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMod?.(mod.id);
            }}
            className="flex items-center gap-1.5 rounded-full bg-mint-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md active:scale-95"
          >
            {ICON_PLAY}
            Open
          </button>
        ) : (
          // Installed but disabled - show Enable button (outlined, secondary)
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEnableMod?.(mod.id);
            }}
            disabled={isActionLoading('enable')}
            className="flex items-center gap-1.5 rounded-full border border-mint-500 bg-white px-3 py-1.5 text-xs font-medium text-mint-600 shadow-sm transition-all hover:bg-mint-50 hover:border-mint-600 hover:text-mint-700 active:scale-95 disabled:opacity-60"
          >
            {isActionLoading('enable') ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint-500 border-t-transparent" />
            ) : (
              ICON_CHECK
            )}
            Enable
          </button>
        )}
      </div>
    </div>
  );
}
