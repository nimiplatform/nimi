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
  "peer h-6 w-11 rounded-full bg-[color:var(--nimi-border-subtle)] transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[color:var(--nimi-border-subtle)] after:bg-[color:var(--nimi-surface-card)] after:transition-all after:content-[''] peer-checked:bg-[var(--nimi-action-primary-bg)] peer-checked:shadow-[0_0_0_1px_color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] peer-checked:after:translate-x-full peer-checked:after:border-[color:var(--nimi-surface-card)]";

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
      return 'rounded-[10px] bg-[var(--nimi-action-primary-bg)] text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_88%,black)]';
    case 'secondary':
      return 'rounded-[10px] bg-transparent text-[color:var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] hover:text-[color:var(--nimi-text-secondary)]';
    case 'danger':
      return 'rounded-[10px] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_16%,transparent)]';
    default:
      return 'rounded-[10px] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] text-[color:var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_88%,white)]';
  }
}

function badgeForState(mod: ModHubMod, t: (key: string, options?: Record<string, unknown>) => string) {
  if (mod.visualState === 'conflict') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]' };
  }
  if (mod.visualState === 'failed') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_16%,transparent)] text-[var(--nimi-status-danger)]' };
  }
  if (mod.visualState === 'update-available') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_16%,transparent)] text-[var(--nimi-status-info)]' };
  }
  if (mod.visualState === 'enabled') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_16%,transparent)] text-[var(--nimi-status-success)]' };
  }
  if (mod.visualState === 'disabled') {
    return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] text-[color:var(--nimi-text-muted)]' };
  }
  return { label: t(`ModHub.${mod.statusLabelKey}`), className: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] text-[color:var(--nimi-text-muted)]' };
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
      : 'rounded-[10px] px-4 py-2 text-[14px] font-medium text-[color:var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] hover:text-[color:var(--nimi-text-secondary)]';
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
          ? 'border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]'
          : `border-transparent hover:border-[color:var(--nimi-border-subtle)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] ${mod.isInstalled && !mod.isEnabled ? 'opacity-70' : ''}`
      }`}
      onClick={handleRowClick}
    >
      {isSelected ? (
        <div className="absolute bottom-4 left-[-24px] top-4 w-[3px] rounded-r-full bg-[var(--nimi-action-primary-bg)]" />
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
              <span className="truncate text-base font-medium text-[color:var(--nimi-text-primary)]">{mod.name}</span>
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--nimi-text-muted)]">{mod.version}</span>
              <ModBadge label={stateBadge.label} className={stateBadge.className} />
              {mod.badge === 'official' ? <ModBadge label={t('ModHub.badgeOfficial')} className="bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]" /> : null}
              {mod.badge === 'verified' ? <ModBadge label={t('ModHub.badgeVerified')} className="bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]" /> : null}
              {mod.badge === 'community' ? <ModBadge label={t('ModHub.badgeCommunity')} className="bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]" /> : null}
            </div>
            <p className="mt-1 line-clamp-1 max-w-3xl text-sm text-[color:var(--nimi-text-secondary)]">{mod.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--nimi-text-muted)]">
              <span className="rounded-md border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] px-2 py-0.5">{mod.author}</span>
              {mod.packageType ? <span className="rounded-md border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] px-2 py-0.5">{mod.packageType}</span> : null}
              {mod.installs ? <span>{mod.installs}</span> : null}
              {mod.rating ? (
                <span className="inline-flex items-center gap-0.5 text-[var(--nimi-status-warning)]">
                  {ICON_STAR} {mod.rating}
                </span>
              ) : null}
              {mod.availableUpdateVersion ? (
                <span className="font-medium text-[var(--nimi-status-info)]">
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
                className={`flex h-8 w-8 items-center justify-center rounded-xl text-[color:var(--nimi-text-muted)] transition hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] hover:text-[color:var(--nimi-text-secondary)] ${
                  menuOpen || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                aria-label={t('ModHub.moreActions')}
              >
                {ICON_ELLIPSIS}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-9 z-30 min-w-[160px] overflow-hidden rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] py-1 shadow-[0_12px_28px_rgba(15,23,42,0.10)]">
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
                          ? 'text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)]'
                          : 'text-[color:var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]'
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
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--nimi-status-warning)]">
              <p className="font-medium">{t('ModHub.conflictWarningTitle')}</p>
              <p className="mt-0.5 text-[color:var(--nimi-text-secondary)]">
                {t('ModHub.conflictWarningBody', { count: mod.runtimeConflictPaths?.length || 0 })}
              </p>
              {Array.isArray(mod.runtimeConflictPaths) && mod.runtimeConflictPaths.length > 0 ? (
                <p className="mt-1 break-all text-[10px] text-[color:var(--nimi-text-muted)]">
                  {mod.runtimeConflictPaths.join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {mod.visualState === 'failed' ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--nimi-status-danger)]">
              <p className="font-medium">{t('ModHub.failedWarningTitle')}</p>
              <p className="mt-0.5 text-[color:var(--nimi-text-secondary)]">
                {t('ModHub.failedWarningBody', { error: mod.runtimeError || t('ModHub.failedWarningFallback') })}
              </p>
            </div>
          ) : null}

          {mod.warningText ? (
            <div className="rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] px-3 py-2 text-xs leading-relaxed text-[color:var(--nimi-text-secondary)]">
              {mod.warningText}
            </div>
          ) : null}

          {mod.requiresUserConsent && (consentReasons.length > 0 || addedCapabilities.length > 0) ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-info)_32%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--nimi-status-info)]">
              <p className="font-medium">{t('ModHub.reconsentRequired')}</p>
              {consentReasons.length > 0 ? <p className="mt-0.5">{consentReasons.join('; ')}.</p> : null}
              {addedCapabilities.length > 0 ? (
                <p className="mt-0.5">{t('ModHub.newCapabilities')}: {addedCapabilities.join(', ')}</p>
              ) : null}
            </div>
          ) : null}

          {mod.advisoryCount ? (
            <div className="text-[11px] text-[var(--nimi-status-warning)]">
              {t('ModHub.advisoriesCount', { count: mod.advisoryCount })}
            </div>
          ) : null}

          {mod.updatedAgo ? (
            <div className="text-[11px] text-[color:var(--nimi-text-muted)]">
              {mod.updatedAgo}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

