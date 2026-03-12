import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeConsentReasons, type ModHubActionDescriptor, type ModHubMod, type ModHubPendingActionType } from './mod-hub-model';

const ICON_STAR = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ICON_ELLIPSIS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
);

function ModBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${className}`}>
      {label}
    </span>
  );
}

function actionLabelKey(kind: ModHubActionDescriptor['kind']): string {
  switch (kind) {
    case 'install':
      return 'actionInstall';
    case 'update':
      return 'actionUpdate';
    case 'open':
      return 'actionOpen';
    case 'enable':
      return 'actionEnable';
    case 'disable':
      return 'actionDisable';
    case 'uninstall':
      return 'actionRemove';
    case 'retry':
      return 'actionRetry';
    case 'open-folder':
      return 'actionOpenFolder';
    default:
      return 'actionOpen';
  }
}

function primaryBtnClass(tone: ModHubActionDescriptor['tone']): string {
  switch (tone) {
    case 'primary':
      return 'bg-emerald-600 text-white hover:bg-emerald-700';
    case 'secondary':
      return 'bg-stone-100 text-stone-700 hover:bg-stone-200';
    case 'danger':
      return 'bg-rose-50 text-rose-700 hover:bg-rose-100';
    default:
      return 'bg-stone-50 text-stone-600 hover:bg-stone-100';
  }
}

function badgeForState(mod: ModHubMod, t: (key: string, options?: Record<string, unknown>) => string) {
  if (mod.visualState === 'conflict') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-amber-100 text-amber-800' };
  }
  if (mod.visualState === 'failed') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-rose-100 text-rose-700' };
  }
  if (mod.visualState === 'update-available') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-sky-100 text-sky-700' };
  }
  if (mod.visualState === 'enabled') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-emerald-100 text-emerald-700' };
  }
  if (mod.visualState === 'disabled') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-stone-100 text-stone-500' };
  }
  return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-stone-50 text-stone-400' };
}

export function ModHubRow({
  mod,
  pendingAction,
  isSelected,
  onOpenMod,
  onInstallMod,
  onUninstallMod,
  onEnableMod,
  onDisableMod,
  onUpdateMod,
  onRetryMod,
  onOpenModFolder,
  onSelectMod,
}: {
  mod: ModHubMod;
  pendingAction?: { modId: string; action: ModHubPendingActionType } | null;
  isSelected?: boolean;
  onOpenMod?: ((modId: string) => void) | null;
  onInstallMod?: ((modId: string) => void) | null;
  onUninstallMod?: ((modId: string) => void) | null;
  onEnableMod?: ((modId: string) => void) | null;
  onDisableMod?: ((modId: string) => void) | null;
  onUpdateMod?: ((modId: string) => void) | null;
  onRetryMod?: ((modId: string) => void) | null;
  onOpenModFolder?: ((modId: string) => void) | null;
  onSelectMod?: ((modId: string | null) => void) | null;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const stateBadge = badgeForState(mod, t);
  const consentReasons = describeConsentReasons(mod.consentReasons);
  const addedCapabilities = Array.isArray(mod.addedCapabilities)
    ? mod.addedCapabilities.filter(Boolean)
    : [];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuOpen]);

  const isActionLoading = (action: ModHubPendingActionType) => (
    pendingAction?.modId === mod.id && pendingAction?.action === action
  );

  const runAction = (action: ModHubActionDescriptor['kind']) => {
    switch (action) {
      case 'install':
        onInstallMod?.(mod.id);
        break;
      case 'update':
        onUpdateMod?.(mod.id);
        break;
      case 'open':
        onOpenMod?.(mod.id);
        break;
      case 'enable':
        onEnableMod?.(mod.id);
        break;
      case 'disable':
        onDisableMod?.(mod.id);
        break;
      case 'uninstall':
        onUninstallMod?.(mod.id);
        break;
      case 'retry':
        onRetryMod?.(mod.id);
        break;
      case 'open-folder':
        onOpenModFolder?.(mod.id);
        break;
      default:
        break;
    }
  };

  const renderActionBtn = (action: ModHubActionDescriptor, variant: 'primary' | 'secondary') => {
    const loading = action.kind !== 'open' && action.kind !== 'open-folder' && isActionLoading(action.kind);
    const disabled = action.kind === 'install' && (mod.supportedByDesktop === false || Boolean(mod.installDisabledReason));
    const classes = variant === 'primary'
      ? `rounded-md px-3 py-1 text-xs font-medium ${primaryBtnClass(action.tone)}`
      : 'rounded-md px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700';
    return (
      <button
        key={`${action.kind}-${variant}`}
        type="button"
        disabled={loading || disabled}
        onClick={(event) => {
          event.stopPropagation();
          runAction(action.kind);
        }}
        title={action.kind === 'install' ? mod.installDisabledReason : undefined}
        className={`inline-flex items-center transition disabled:opacity-50 ${classes}`}
      >
        {loading ? t('ModHub.actionLoading') : t(`ModHub.${actionLabelKey(action.kind)}`)}
      </button>
    );
  };

  return (
    <div
      className={`group relative cursor-pointer px-4 py-3 transition-colors ${
        isSelected ? 'bg-emerald-50/50' : 'hover:bg-stone-50/60'
      }`}
      onClick={() => onSelectMod?.(isSelected ? null : mod.id)}
    >
      {isSelected && (
        <div className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-emerald-500" />
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-bold text-white shadow-sm"
          style={{ background: mod.iconBg }}
        >
          {mod.iconImageSrc ? (
            <img
              src={mod.iconImageSrc}
              alt={`${mod.name} logo`}
              className="h-full w-full object-contain p-1"
            />
          ) : (
            mod.iconText
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-stone-900">{mod.name}</span>
            <span className="shrink-0 text-[11px] text-stone-400">{mod.version}</span>
            <ModBadge label={stateBadge.label} className={stateBadge.className} />
            {mod.badge === 'official' ? <ModBadge label={t('ModHub.badgeOfficial')} className="bg-emerald-50 text-emerald-700" /> : null}
            {mod.badge === 'verified' ? <ModBadge label={t('ModHub.badgeVerified')} className="bg-sky-50 text-sky-700" /> : null}
            {mod.badge === 'community' ? <ModBadge label={t('ModHub.badgeCommunity')} className="bg-amber-50 text-amber-800" /> : null}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-stone-500">{mod.description}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-stone-400">
            <span>{mod.author}</span>
            {mod.packageType ? <span className="text-stone-300">|</span> : null}
            {mod.packageType ? <span>{mod.packageType}</span> : null}
            {mod.installs ? <span>{mod.installs}</span> : null}
            {mod.rating ? (
              <span className="inline-flex items-center gap-0.5 text-amber-500">
                {ICON_STAR} {mod.rating}
              </span>
            ) : null}
            {mod.availableUpdateVersion ? (
              <span className="font-medium text-sky-600">
                {t('ModHub.updateVersion', { version: mod.availableUpdateVersion.replace(/^v/i, '') })}
              </span>
            ) : null}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {mod.primaryAction ? renderActionBtn(mod.primaryAction, 'primary') : null}
          {mod.secondaryAction ? renderActionBtn(mod.secondaryAction, 'secondary') : null}
          {mod.menuActions.length > 0 ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => !current);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 ${
                  menuOpen || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label={t('ModHub.moreActions')}
              >
                {ICON_ELLIPSIS}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-8 z-30 min-w-[140px] overflow-hidden rounded-lg border border-stone-200/80 bg-white py-1 shadow-lg">
                  {mod.menuActions.map((action) => (
                    <button
                      key={action.kind}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen(false);
                        runAction(action.kind);
                      }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition ${
                        action.tone === 'danger'
                          ? 'text-rose-600 hover:bg-rose-50'
                          : 'text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {t(`ModHub.${actionLabelKey(action.kind)}`)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Expanded details on selection */}
      {isSelected ? (
        <div className="ml-14 mt-2.5 space-y-2">
          {mod.visualState === 'conflict' ? (
            <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <p className="font-medium">{t('ModHub.conflictWarningTitle')}</p>
              <p className="mt-0.5 text-amber-800">
                {t('ModHub.conflictWarningBody', { count: mod.runtimeConflictPaths?.length || 0 })}
              </p>
              {Array.isArray(mod.runtimeConflictPaths) && mod.runtimeConflictPaths.length > 0 ? (
                <p className="mt-1 break-all text-[10px] text-amber-700">
                  {mod.runtimeConflictPaths.join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {mod.visualState === 'failed' ? (
            <div className="rounded-lg border border-rose-200/80 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900">
              <p className="font-medium">{t('ModHub.failedWarningTitle')}</p>
              <p className="mt-0.5 text-rose-800">
                {t('ModHub.failedWarningBody', { error: mod.runtimeError || t('ModHub.failedWarningFallback') })}
              </p>
            </div>
          ) : null}

          {mod.warningText ? (
            <div className="rounded-lg border border-stone-200/80 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
              {mod.warningText}
            </div>
          ) : null}

          {mod.requiresUserConsent && (consentReasons.length > 0 || addedCapabilities.length > 0) ? (
            <div className="rounded-lg border border-sky-200/80 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
              <p className="font-medium">{t('ModHub.reconsentRequired')}</p>
              {consentReasons.length > 0 ? <p className="mt-0.5">{consentReasons.join('; ')}.</p> : null}
              {addedCapabilities.length > 0 ? (
                <p className="mt-0.5">{t('ModHub.newCapabilities')}: {addedCapabilities.join(', ')}</p>
              ) : null}
            </div>
          ) : null}

          {mod.advisoryCount ? (
            <div className="text-[11px] text-amber-600">
              {t('ModHub.advisoriesCount', { count: mod.advisoryCount })}
            </div>
          ) : null}

          {mod.updatedAgo ? (
            <div className="text-[11px] text-stone-400">
              {mod.updatedAgo}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
