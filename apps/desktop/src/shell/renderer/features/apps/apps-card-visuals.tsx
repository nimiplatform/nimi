import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Code2, LoaderCircle, PackageOpen } from 'lucide-react';
import { StatusBadge } from '@nimiplatform/kit/ui';
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

const ICON_SIZE_CLASS = Object.freeze({
  xs: 'h-6 w-6 rounded-md text-xs',
  sm: 'h-8 w-8 rounded-lg text-sm',
  md: 'h-10 w-10 rounded-xl text-base',
  lg: 'h-16 w-16 rounded-2xl text-2xl',
} as const);

export type AppArtworkIconSize = keyof typeof ICON_SIZE_CLASS;

export function AppArtworkIcon({
  appId,
  displayName,
  size = 'md',
  className = '',
}: {
  readonly appId: string;
  readonly displayName: string;
  readonly size?: AppArtworkIconSize;
  readonly className?: string;
}): ReactElement {
  const artwork = appArtworkFor(appId);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center font-semibold text-white ${ICON_SIZE_CLASS[size]} ${className}`}
      style={{
        background: artwork.iconBackground,
        fontFamily: 'var(--nimi-font-display)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 6px rgba(15,23,42,0.18)',
      }}
    >
      {deriveIconGlyph(displayName)}
    </span>
  );
}

export function AppArtworkCover({
  appId,
  displayName,
  className = '',
  showIcon = true,
}: {
  readonly appId: string;
  readonly displayName: string;
  readonly className?: string;
  readonly showIcon?: boolean;
}): ReactElement {
  const artwork = appArtworkFor(appId);
  return (
    <div
      aria-hidden="true"
      className={`relative select-none overflow-hidden ${className}`}
      style={{ background: artwork.coverBackground }}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-14 -left-8 h-28 w-28 rounded-full bg-white/40 blur-3xl" />
      {showIcon ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <AppArtworkIcon
            appId={appId}
            displayName={displayName}
            size="lg"
            className="shadow-[var(--nimi-elevation-raised)]"
          />
        </div>
      ) : null}
    </div>
  );
}

export function appRunStatusLabel(
  t: (key: string) => string,
  visual: AppRunVisualState,
): string {
  return t(`Apps.runState.${visual}`);
}

export function AppRunStatusLine({ entry }: { readonly entry: DesktopAppsEntry }): ReactElement {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  const dotClass = visual === 'running'
    ? 'bg-[var(--nimi-status-success)]'
    : visual === 'starting'
      ? 'bg-[var(--nimi-action-primary-bg)]'
      : visual === 'failed'
        ? 'bg-[var(--nimi-status-danger)]'
        : 'bg-[var(--nimi-text-muted)] opacity-50';
  return (
    <span
      data-testid={`apps-entry-${entry.identity.entryKey}-state`}
      data-run-visual={visual}
      title={visual === 'failed' ? entry.run?.message : undefined}
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${visual === 'stopped' ? 'text-[color:var(--nimi-text-muted)]' : visual === 'running' ? 'text-[var(--nimi-status-success)]' : visual === 'failed' ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-action-primary-bg)]'}`}
    >
      {visual === 'starting' ? (
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      )}
      {appRunStatusLabel(t, visual)}
    </span>
  );
}

export function AppRunStatusBadge({ entry }: { readonly entry: DesktopAppsEntry }): ReactElement {
  const { t } = useTranslation();
  const visual = appRunVisualState(entry.run?.state ?? null);
  return (
    <StatusBadge tone={APP_RUN_BADGE_TONE[visual]} data-run-visual={visual}>
      {visual === 'starting' ? (
        <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {appRunStatusLabel(t, visual)}
    </StatusBadge>
  );
}

export function AppPackageStatusLine({ entry }: { readonly entry: DesktopAppsEntry }): ReactElement | null {
  const { t } = useTranslation();
  if (entry.localDevelopment) return null;
  const job = entry.packageJob;
  const progress = job ? appPackageProgressText(job) : null;
  const failureReason = job ? appPackageFailureReason(job) : null;
  const versionLabel = entry.committedRelease
    ? t('Apps.version.installed', { version: entry.committedRelease.version })
    : t('Apps.version.notInstalled');
  const phaseLocaleKey = job ? appPackagePhaseLocaleKey(job) : null;
  const phaseLabel = job
    ? phaseLocaleKey ? t(`Apps.phase.${phaseLocaleKey}`) : String(job.phase)
    : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--nimi-text-muted)]">
      <span data-testid={`apps-entry-${entry.identity.entryKey}-installed-version`}>{versionLabel}</span>
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
    </div>
  );
}

const SOURCE_BADGE_META = Object.freeze({
  local_development: {
    icon: Code2,
    labelKey: 'Apps.sourceBadge.localDevelopment',
    className: 'border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] text-[color:var(--nimi-text-secondary)]',
  },
  user_imported: {
    icon: PackageOpen,
    labelKey: 'Apps.sourceBadge.userImported',
    className: 'border-[color:var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
  },
  verified: {
    icon: BadgeCheck,
    labelKey: 'Apps.sourceBadge.verified',
    className: 'border-[color:var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
  },
} as const);

export function AppSourceBadge({
  source,
  className = '',
}: {
  readonly source: AppSourceId;
  readonly className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const meta = SOURCE_BADGE_META[source];
  const Icon = meta.icon;
  return (
    <span
      data-source-badge={source}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${meta.className} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}
