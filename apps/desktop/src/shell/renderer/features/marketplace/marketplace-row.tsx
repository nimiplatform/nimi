import type { BadgeType, MarketplaceMod, MarketplaceRuntimeAction } from './marketplace-model';
import { MARKETPLACE_COLORS } from './marketplace-model';

const ICON_STAR = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

function ModBadge({ type }: { type: BadgeType }) {
  const styles: Record<BadgeType, { bg: string; color: string; label: string }> = {
    official: { bg: MARKETPLACE_COLORS.green100, color: MARKETPLACE_COLORS.green700, label: 'Official' },
    verified: { bg: MARKETPLACE_COLORS.cyan100, color: MARKETPLACE_COLORS.cyan700, label: 'Verified' },
    community: { bg: MARKETPLACE_COLORS.gray100, color: MARKETPLACE_COLORS.gray600, label: 'Community' },
  };
  const current = styles[type];

  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: current.bg, color: current.color }}
    >
      {current.label}
    </span>
  );
}

function RuntimeActionButton(input: {
  label: string;
  onClick?: (() => void) | null;
  loading?: boolean;
  tone?: 'default' | 'danger' | 'success';
}) {
  const toneClass = input.tone === 'danger'
    ? 'border-red-200 text-red-600 hover:bg-red-50'
    : input.tone === 'success'
      ? 'border-green-200 text-green-700 hover:bg-green-50'
      : 'border-gray-200 text-gray-700 hover:bg-gray-50';
  return (
    <button
      type="button"
      onClick={input.onClick || undefined}
      disabled={Boolean(input.loading) || !input.onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {input.loading ? `${input.label}...` : input.label}
    </button>
  );
}

export function MarketplaceRow({
  mod,
  pendingAction,
  onOpenMod,
  onInstallMod,
  onUninstallMod,
  onEnableMod,
  onDisableMod,
  onOpenModSettings,
}: {
  mod: MarketplaceMod;
  pendingAction?: { modId: string; action: MarketplaceRuntimeAction } | null;
  onOpenMod?: ((modId: string) => void) | null;
  onInstallMod?: ((modId: string) => void) | null;
  onUninstallMod?: ((modId: string) => void) | null;
  onEnableMod?: ((modId: string) => void) | null;
  onDisableMod?: ((modId: string) => void) | null;
  onOpenModSettings?: ((modId: string) => void) | null;
}) {
  const runtimeStatusLabel = !mod.isInstalled
    ? 'Not installed'
    : (mod.isEnabled ? 'Enabled' : 'Disabled');
  const isRuntimeRow = mod.source === 'runtime';
  const isActionLoading = (action: MarketplaceRuntimeAction) => (
    pendingAction?.modId === mod.id && pendingAction?.action === action
  );

  return (
    <div className="flex items-center gap-4 border-b border-gray-100 px-6 py-4 transition-colors hover:bg-gray-50">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
        style={{ background: mod.iconBg }}
      >
        {mod.iconText}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{mod.name}</span>
          <ModBadge type={mod.badge} />
        </div>
        <p className="mt-0.5 text-xs text-gray-600">{mod.description}</p>
        {isRuntimeRow ? (
          <>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <span>{mod.author || 'Runtime Mod'}</span>
              <span className="text-gray-300">·</span>
              <span>Runtime</span>
              <span className="text-gray-300">·</span>
              <span>{runtimeStatusLabel}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">{mod.version}</div>
          </>
        ) : (
          <>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <span>{mod.author}</span>
              <span className="text-gray-300">·</span>
              <span className="flex items-center gap-0.5 text-amber-500">{ICON_STAR}</span>
              <span>{mod.rating}</span>
              <span className="text-gray-400">({mod.ratingCount})</span>
              <span className="text-gray-300">·</span>
              <span>{mod.installs} installs</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              {mod.version} <span className="text-gray-300">·</span> {mod.updatedAgo}
            </div>
          </>
        )}
      </div>

      {isRuntimeRow ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {!mod.isInstalled ? (
            <RuntimeActionButton
              label="Install"
              onClick={onInstallMod ? () => onInstallMod(mod.id) : null}
              loading={isActionLoading('install')}
              tone="success"
            />
          ) : (
            <>
              {mod.isEnabled ? (
                <RuntimeActionButton
                  label="Disable"
                  onClick={onDisableMod ? () => onDisableMod(mod.id) : null}
                  loading={isActionLoading('disable')}
                />
              ) : (
                <RuntimeActionButton
                  label="Enable"
                  onClick={onEnableMod ? () => onEnableMod(mod.id) : null}
                  loading={isActionLoading('enable')}
                  tone="success"
                />
              )}
              <RuntimeActionButton
                label="Uninstall"
                onClick={onUninstallMod ? () => onUninstallMod(mod.id) : null}
                loading={isActionLoading('uninstall')}
                tone="danger"
              />
              <RuntimeActionButton
                label="Settings"
                onClick={onOpenModSettings ? () => onOpenModSettings(mod.id) : null}
              />
            </>
          )}
        </div>
      ) : (
        <RuntimeActionButton
          label="Install"
          onClick={onOpenMod ? () => onOpenMod(mod.id) : null}
          tone="success"
        />
      )}
    </div>
  );
}
