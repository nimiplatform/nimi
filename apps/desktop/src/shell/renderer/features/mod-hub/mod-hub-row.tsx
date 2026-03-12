import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeConsentReasons, type ModHubActionDescriptor, type ModHubMod, type ModHubPendingActionType } from './mod-hub-model';

const ICON_STAR = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ICON_MORE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

function ModBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${className}`}>
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

function actionClassNames(tone: ModHubActionDescriptor['tone']): string {
  switch (tone) {
    case 'primary':
      return 'border border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600';
    case 'secondary':
      return 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100';
    case 'danger':
      return 'border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100';
    default:
      return 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50';
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
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-stone-200 text-stone-700' };
  }
  return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-stone-100 text-stone-500' };
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

  const renderAction = (action: ModHubActionDescriptor, compact = false) => {
    const loading = action.kind !== 'open' && action.kind !== 'open-folder' && isActionLoading(action.kind);
    const disabled = action.kind === 'install' && (mod.supportedByDesktop === false || Boolean(mod.installDisabledReason));
    return (
      <button
        key={`${action.kind}-${compact ? 'compact' : 'full'}`}
        type="button"
        disabled={loading || disabled}
        onClick={(event) => {
          event.stopPropagation();
          runAction(action.kind);
        }}
        title={action.kind === 'install' ? mod.installDisabledReason : undefined}
        className={`inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${actionClassNames(action.tone)} ${compact ? 'min-w-[96px]' : ''}`}
      >
        {loading ? t('ModHub.actionLoading') : t(`ModHub.${actionLabelKey(action.kind)}`)}
      </button>
    );
  };

  return (
    <div
      className={`relative rounded-[28px] border bg-white/92 p-4 shadow-[0_18px_50px_rgba(120,113,108,0.08)] transition ${
        isSelected
          ? 'border-emerald-300 ring-2 ring-emerald-100'
          : 'border-stone-200/80 hover:border-emerald-200'
      }`}
      onClick={() => onSelectMod?.(isSelected ? null : mod.id)}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] text-base font-bold text-white shadow-[0_16px_28px_rgba(15,23,42,0.14)]"
          style={{ background: mod.iconBg }}
        >
          {mod.iconText}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-900">{mod.name}</h3>
            <span className="text-xs text-stone-400">{mod.version}</span>
            <ModBadge label={stateBadge.label} className={stateBadge.className} />
            {mod.badge === 'official' ? <ModBadge label={t('ModHub.badgeOfficial')} className="bg-emerald-100 text-emerald-700" /> : null}
            {mod.badge === 'verified' ? <ModBadge label={t('ModHub.badgeVerified')} className="bg-sky-100 text-sky-700" /> : null}
            {mod.badge === 'community' ? <ModBadge label={t('ModHub.badgeCommunity')} className="bg-amber-100 text-amber-800" /> : null}
          </div>

          <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">
            {mod.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
            <span>{mod.author}</span>
            {mod.packageType ? <span>{mod.packageType}</span> : null}
            {mod.availableUpdateVersion ? (
              <span className="font-medium text-sky-700">
                {t('ModHub.updateVersion', { version: mod.availableUpdateVersion.replace(/^v/i, '') })}
              </span>
            ) : null}
            {mod.advisoryCount ? (
              <span className="font-medium text-amber-700">
                {t('ModHub.advisoriesCount', { count: mod.advisoryCount })}
              </span>
            ) : null}
            {mod.rating ? (
              <span className="inline-flex items-center gap-1 text-amber-500">
                {ICON_STAR}
                {mod.rating}
              </span>
            ) : null}
            {mod.installs ? <span>{mod.installs}</span> : null}
            {mod.updatedAgo ? <span>{mod.updatedAgo}</span> : null}
          </div>

          {mod.visualState === 'conflict' ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
              <p className="font-semibold">{t('ModHub.conflictWarningTitle')}</p>
              <p className="mt-1">
                {t('ModHub.conflictWarningBody', { count: mod.runtimeConflictPaths?.length || 0 })}
              </p>
              {Array.isArray(mod.runtimeConflictPaths) && mod.runtimeConflictPaths.length > 0 ? (
                <p className="mt-1 break-all text-[11px] text-amber-800">
                  {mod.runtimeConflictPaths.join(' • ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {mod.visualState === 'failed' ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-900">
              <p className="font-semibold">{t('ModHub.failedWarningTitle')}</p>
              <p className="mt-1">
                {t('ModHub.failedWarningBody', { error: mod.runtimeError || t('ModHub.failedWarningFallback') })}
              </p>
            </div>
          ) : null}

          {mod.warningText ? (
            <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs leading-5 text-stone-700">
              {mod.warningText}
            </div>
          ) : null}

          {mod.requiresUserConsent && (consentReasons.length > 0 || addedCapabilities.length > 0) ? (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900">
              <p className="font-semibold text-sky-950">{t('ModHub.reconsentRequired')}</p>
              {consentReasons.length > 0 ? <p className="mt-1">{consentReasons.join('; ')}.</p> : null}
              {addedCapabilities.length > 0 ? (
                <p className="mt-1">
                  {t('ModHub.newCapabilities')}: {addedCapabilities.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {mod.primaryAction ? renderAction(mod.primaryAction, true) : null}
          {mod.secondaryAction ? renderAction(mod.secondaryAction, true) : null}
          {mod.menuActions.length > 0 ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => !current);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-stone-300 hover:text-stone-700"
                aria-label={t('ModHub.moreActions')}
              >
                {ICON_MORE}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-11 z-30 min-w-[180px] rounded-2xl border border-stone-200 bg-white p-2 shadow-[0_18px_40px_rgba(28,25,23,0.14)]">
                  {mod.menuActions.map((action) => (
                    <button
                      key={action.kind}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen(false);
                        runAction(action.kind);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${action.tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-stone-700 hover:bg-stone-50'}`}
                    >
                      <span>{t(`ModHub.${actionLabelKey(action.kind)}`)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
