import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Code2, PackageOpen } from 'lucide-react';
import { Button, StatusBadge, Tooltip, type StatusBadgeShape } from '@nimiplatform/kit/ui';
import { AppPackageJobPhase } from '@nimiplatform/sdk/runtime/wire-types';
import { formatBytes } from '../../components/download-format.js';
import { useAppsDownloads } from './apps-downloads-context.js';
import { packageJobKey } from './apps-downloads-observer.js';
import {
  APP_RUN_BADGE_TONE,
  appPackageFailureReason,
  appPackagePhaseLocaleKey,
  appPackageProgressText,
  appArtworkFor,
  appRunVisualState,
  deriveIconGlyph,
  type AppRunVisualState,
  type AppSourceId,
} from './apps-card-fields.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import { hasAvailableCatalogUpdate } from './apps-card-actions.js';

const ICON_SIZE_CLASS = Object.freeze({
  xs: 'h-6 w-6 rounded-md text-xs',
  sm: 'h-8 w-8 rounded-lg text-sm',
  md: 'h-10 w-10 rounded-xl text-base',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
  xl: 'h-12 w-12 rounded-xl text-lg',
} as const);

export type AppArtworkIconSize = keyof typeof ICON_SIZE_CLASS;

export function AppArtworkIcon({
  appId,
  displayName,
  iconUrl = null,
  size = 'md',
  className = '',
}: {
  readonly appId: string;
  readonly displayName: string;
  readonly iconUrl?: string | null;
  readonly size?: AppArtworkIconSize;
  readonly className?: string;
}): ReactElement {
  const artwork = appArtworkFor(appId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const visibleUrl = iconUrl && iconUrl !== failedUrl ? iconUrl : null;
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold text-white ${ICON_SIZE_CLASS[size]} ${className}`}
      style={{
        background: visibleUrl ? 'transparent' : artwork.iconBackground,
        fontFamily: 'var(--nimi-font-display)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 6px rgba(15,23,42,0.18)',
      }}
    >
      {visibleUrl ? (
        <img src={visibleUrl} alt="" className="absolute inset-0 h-full w-full object-contain" onError={() => setFailedUrl(visibleUrl)} />
      ) : deriveIconGlyph(displayName)}
    </span>
  );
}

export function appRunStatusLabel(
  t: (key: string) => string,
  visual: AppRunVisualState,
): string {
  return t(`Apps.runState.${visual}`);
}

/**
 * Settled run status for a detail header. A launch or stop in progress is
 * shown on the header's action button instead, so callers omit the badge
 * while a transition is underway.
 */
export function AppRunStatusBadge({
  entry,
  shape = 'soft',
}: {
  readonly entry: DesktopAppsEntry;
  readonly shape?: StatusBadgeShape;
}): ReactElement {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  return (
    <StatusBadge
      tone={APP_RUN_BADGE_TONE[visual]}
      shape={shape}
      data-run-visual={visual}
      title={visual === 'failed' ? entry.run?.message : undefined}
    >
      {appRunStatusLabel(t, visual)}
    </StatusBadge>
  );
}

export function AppPackageStatusLine({
  entry,
  showInstalledVersion = true,
  className = '',
}: {
  readonly entry: DesktopAppsEntry;
  readonly showInstalledVersion?: boolean;
  readonly className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const downloads = useAppsDownloads();
  if (entry.localDevelopment) return null;
  const job = entry.packageJob;
  if (!entry.committedRelease && !job) return null;
  const progress = job && [AppPackageJobPhase.DOWNLOADING, AppPackageJobPhase.PAUSED].includes(job.phase)
    ? `${formatBytes(Number(job.bytesCompleted))}${job.bytesTotal ? ` / ${formatBytes(Number(job.bytesTotal))}` : ''}`
    : job ? appPackageProgressText(job) : null;
  const failureReason = job ? appPackageFailureReason(job) : null;
  const versionLabel = showInstalledVersion && entry.committedRelease
    ? t('Apps.version.installed', { version: entry.committedRelease.version })
    : null;
  const updateAvailable = hasAvailableCatalogUpdate(entry);
  const phaseLocaleKey = job ? appPackagePhaseLocaleKey(job) : null;
  const phaseLabel = job
    ? phaseLocaleKey ? t(`Apps.phase.${phaseLocaleKey}`) : String(job.phase)
    : null;
  if (!versionLabel && !updateAvailable && !phaseLabel && !failureReason) return null;
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--nimi-text-secondary)] ${className}`}>
      {versionLabel ? <span data-testid={`apps-entry-${entry.identity.entryKey}-installed-version`}>{versionLabel}</span> : null}
      {updateAvailable ? <span className="text-[var(--nimi-status-info)]" data-testid={`apps-entry-${entry.identity.entryKey}-available-version`}>{t('Apps.update.available', { version: entry.catalogTarget?.version })}</span> : null}
      {phaseLabel ? (
        <span data-testid={`apps-entry-${entry.identity.entryKey}-package-job`} data-package-job-phase={job?.phase}>
          {phaseLabel}{progress ? ` · ${progress}` : ''}
        </span>
      ) : null}
      {failureReason ? (
        <span className="text-[var(--nimi-status-danger)]" data-package-job-failure={failureReason}>
          {failureReason}
        </span>
      ) : null}
      {job && downloads ? <Button className="relative z-10" size="sm" tone="ghost" onClick={(event) => { event.stopPropagation(); downloads.openDownloads(packageJobKey(job)); }}>{t('Apps.downloads.viewTask')}</Button> : null}
    </div>
  );
}

const SOURCE_BADGE_META = Object.freeze({
  local_development: {
    icon: Code2,
    labelKey: 'Apps.sourceBadge.localDevelopment',
    pillClassName: 'border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] text-[color:var(--nimi-text-secondary)]',
    quietClassName: 'text-[color:var(--nimi-text-muted)]',
  },
  user_imported: {
    icon: PackageOpen,
    labelKey: 'Apps.sourceBadge.userImported',
    pillClassName: 'border-[color:var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
    quietClassName: 'text-[var(--nimi-status-info-soft-text)]',
  },
  verified: {
    icon: BadgeCheck,
    labelKey: 'Apps.sourceBadge.verified',
    pillClassName: 'border-[color:var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
    quietClassName: 'text-[var(--nimi-status-success-soft-text)]',
  },
} as const);

export function AppSourceBadge({
  source,
  variant = 'pill',
  className = '',
  description,
}: {
  readonly source: AppSourceId;
  readonly variant?: 'pill' | 'quiet';
  readonly className?: string;
  readonly description?: string;
}): ReactElement {
  const { t } = useTranslation();
  const meta = SOURCE_BADGE_META[source];
  const Icon = meta.icon;
  if (source === 'verified') {
    const badge = (
      <span
        data-source-badge={source}
        role="img"
        aria-label={t(meta.labelKey)}
        className={`inline-flex shrink-0 self-start text-[var(--nimi-status-success-soft-text)] ${className}`}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
      </span>
    );
    return description ? (
      <Tooltip content={description} contentClassName="max-w-xs font-normal">
        {badge}
      </Tooltip>
    ) : badge;
  }
  // Source is static provenance, not a live status: the quiet variant keeps
  // the same icon and copy as inline metadata so status pills stand out.
  const variantClassName = variant === 'quiet'
    ? meta.quietClassName
    : `border px-1.5 py-0.5 ${meta.pillClassName}`;
  return (
    <span
      data-source-badge={source}
      data-source-badge-variant={variant}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md text-[11px] font-medium leading-4 ${variantClassName} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}
