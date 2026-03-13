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

const SWITCH_TRACK_CLASS =
  "peer h-6 w-11 rounded-full bg-gray-200 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#56D3B2] peer-checked:shadow-[0_0_0_1px_rgba(86,211,178,0.12)] peer-checked:after:translate-x-full peer-checked:after:border-white";

function ModBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.04em] ${className}`}>
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
    case 'settings':
      return 'actionSettings';
    default:
      return 'actionOpen';
  }
}

function primaryBtnClass(tone: ModHubActionDescriptor['tone']): string {
  switch (tone) {
    case 'primary':
      return 'rounded-[10px] bg-[#00C48C] text-white shadow-[0_4px_12px_rgba(0,196,140,0.20)] hover:bg-[#00b07e]';
    case 'secondary':
      return 'rounded-[10px] bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700';
    case 'danger':
      return 'rounded-[10px] bg-rose-50 text-rose-700 hover:bg-rose-100';
    default:
      return 'rounded-[10px] bg-slate-50 text-slate-600 hover:bg-slate-100';
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
  onOpenModSettings,
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
  onOpenModSettings?: ((modId: string) => void) | null;
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

  const canToggle = mod.isInstalled && mod.visualState !== 'conflict' && mod.visualState !== 'failed';
  const toggleLoading = isActionLoading(mod.isEnabled ? 'disable' : 'enable');
  const openAction = mod.primaryAction?.kind === 'open'
    ? mod.primaryAction
    : mod.secondaryAction?.kind === 'open'
      ? mod.secondaryAction
      : null;
  const fallbackPrimaryAction = openAction ? null : mod.primaryAction;

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
      case 'settings':
        onOpenModSettings?.(mod.id);
        break;
      default:
        break;
    }
  };

  const renderActionBtn = (action: ModHubActionDescriptor, variant: 'primary' | 'secondary') => {
    const loading = action.kind !== 'open' && action.kind !== 'open-folder' && action.kind !== 'settings' && isActionLoading(action.kind);
    const disabled = action.kind === 'install' && (mod.supportedByDesktop === false || Boolean(mod.installDisabledReason));
    const classes = variant === 'primary'
      ? `px-5 py-2 text-[14px] font-semibold ${primaryBtnClass(action.tone)}`
      : 'rounded-[10px] px-4 py-2 text-[14px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700';
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

  const handleRowClick = () => {
    if (openAction) {
      runAction('open');
      return;
    }
    onSelectMod?.(isSelected ? null : mod.id);
  };

  return (
    <div
      className={`group relative cursor-pointer rounded-2xl border py-4 transition-colors ${
        isSelected
          ? 'border-gray-100 bg-gray-50'
          : `border-transparent hover:border-gray-100 hover:bg-gray-50 ${mod.isInstalled && !mod.isEnabled ? 'opacity-70' : ''}`
      }`}
      onClick={handleRowClick}
    >
      {isSelected ? (
        <div className="absolute bottom-4 left-[-24px] top-4 w-[3px] rounded-r-full bg-emerald-500" />
      ) : null}

      <div className="flex items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-bold text-white ${
              mod.iconImageSrc ? '' : 'shadow-sm'
            } ${mod.isInstalled && !mod.isEnabled ? 'grayscale' : ''}`}
            style={{ background: mod.iconImageSrc ? 'transparent' : mod.iconBg }}
          >
            {mod.iconImageSrc ? (
              <img
                src={mod.iconImageSrc}
                alt={`${mod.name} logo`}
                className="h-full w-full object-contain"
              />
            ) : (
              mod.iconText
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-medium text-gray-900">{mod.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{mod.version}</span>
              <ModBadge label={stateBadge.label} className={stateBadge.className} />
              {mod.badge === 'official' ? <ModBadge label={t('ModHub.badgeOfficial')} className="bg-emerald-50 text-emerald-700" /> : null}
              {mod.badge === 'verified' ? <ModBadge label={t('ModHub.badgeVerified')} className="bg-sky-50 text-sky-700" /> : null}
              {mod.badge === 'community' ? <ModBadge label={t('ModHub.badgeCommunity')} className="bg-amber-50 text-amber-800" /> : null}
            </div>
            <p className="mt-1 line-clamp-1 max-w-3xl text-sm text-gray-500">{mod.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5">{mod.author}</span>
              {mod.packageType ? <span className="rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5">{mod.packageType}</span> : null}
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
        </div>

        <div className="ml-4 flex shrink-0 items-center gap-4">
          {fallbackPrimaryAction ? renderActionBtn(fallbackPrimaryAction, 'primary') : null}
          {!openAction && mod.secondaryAction ? renderActionBtn(mod.secondaryAction, 'secondary') : null}
          {canToggle ? (
            <label
              className="relative inline-flex items-center cursor-pointer"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={mod.isEnabled}
                disabled={toggleLoading}
                onChange={() => runAction(mod.isEnabled ? 'disable' : 'enable')}
              />
              <div className={SWITCH_TRACK_CLASS} />
            </label>
          ) : null}
          {mod.menuActions.length > 0 ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => !current);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 ${
                  menuOpen || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label={t('ModHub.moreActions')}
              >
                {ICON_ELLIPSIS}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-9 z-30 min-w-[160px] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1 shadow-[0_12px_28px_rgba(15,23,42,0.10)]">
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
                          : 'text-slate-600 hover:bg-slate-50'
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

      {isSelected ? (
        <div className="ml-[64px] mt-3 space-y-2.5 px-4 pb-1">
          {mod.visualState === 'conflict' ? (
            <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <p className="font-medium">{t('ModHub.conflictWarningTitle')}</p>
              <p className="mt-0.5 text-amber-800">
                {t('ModHub.conflictWarningBody', { count: mod.runtimeConflictPaths?.length || 0 })}
              </p>
              {Array.isArray(mod.runtimeConflictPaths) && mod.runtimeConflictPaths.length > 0 ? (
                <p className="mt-1 break-all text-[10px] text-amber-700">
                  {mod.runtimeConflictPaths.join(' ¡¤ ')}
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

