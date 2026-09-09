import { AppPackageJobPhase, AppPackageSourceClass, type AppPackageJob, type CommittedAppRelease } from '@nimiplatform/sdk/runtime/wire-types';
import semver from 'semver';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

export type AppCardActionId = 'details' | 'open-ai-config' | 'install' | 'update' | 'launch' | 'stop' | 'remove' | 'uninstall' | 'cancel-job';

export interface AppCardAction {
  readonly id: AppCardActionId;
}

export interface AppCardActionPlan {
  readonly primary: AppCardAction | null;
  readonly secondary: readonly AppCardAction[];
}

type AppsActionEntry = {
  readonly catalogTarget: { readonly policyBlocked: boolean; readonly version?: string } | null;
  readonly committedRelease: Pick<CommittedAppRelease, 'sourceClass'> & { readonly version?: string } | null;
  readonly localDevelopment: unknown | null;
  readonly packageJob: Pick<AppPackageJob, 'cancelable' | 'phase'> | null;
  readonly run: { readonly state: string } | null;
};

const DETAILS: AppCardAction = { id: 'details' };
const LAUNCH: AppCardAction = { id: 'launch' };
const STOP: AppCardAction = { id: 'stop' };
const REMOVE: AppCardAction = { id: 'remove' };
const CANCEL_JOB: AppCardAction = { id: 'cancel-job' };
const TERMINAL_RUN_STATES = Object.freeze([
  'stopped',
  'failed',
  'crashed',
  'project-changed',
  'registration-unavailable',
  'registration-removed',
  'launcher-disconnected',
] as const);

export function isLocalDevelopmentRunActive(runState: string | null): boolean {
  return runState !== null && !(TERMINAL_RUN_STATES as readonly string[]).includes(runState);
}

export function actionPlanForLocalDevelopmentEntry(runState: string | null): AppCardActionPlan {
  const active = isLocalDevelopmentRunActive(runState);
  return {
    primary: active ? STOP : LAUNCH,
    secondary: [DETAILS, REMOVE],
  };
}

export function actionPlanForEntry(entry: AppsActionEntry): AppCardActionPlan {
  const base = entry.localDevelopment
    ? actionPlanForLocalDevelopmentEntry(entry.run?.state ?? null)
    : entry.committedRelease?.sourceClass === AppPackageSourceClass.VERIFIED && (!packageJobActive(entry.packageJob) || isLocalDevelopmentRunActive(entry.run?.state ?? null))
      ? { primary: entry.catalogTarget?.policyBlocked && !isLocalDevelopmentRunActive(entry.run?.state ?? null) ? null : LAUNCH,
          secondary: isLocalDevelopmentRunActive(entry.run?.state ?? null) ? [DETAILS, STOP] : [DETAILS] }
      : { primary: null, secondary: [DETAILS] };
  return entry.packageJob?.cancelable
    ? { ...base, secondary: [...base.secondary, CANCEL_JOB] }
    : base;
}

export function canRequestCatalogInstall(entry: AppsActionEntry): boolean {
  return Boolean(entry.catalogTarget && !entry.catalogTarget.policyBlocked && !entry.committedRelease && !packageJobActive(entry.packageJob));
}

export function hasAvailableCatalogUpdate(entry: AppsActionEntry): boolean {
  const target = entry.catalogTarget?.version;
  const current = entry.committedRelease?.version;
  return Boolean(!entry.localDevelopment && entry.committedRelease?.sourceClass === AppPackageSourceClass.VERIFIED
    && target && current && semver.valid(target) && semver.valid(current) && semver.gt(target, current));
}

export function canRequestCatalogUpdate(entry: AppsActionEntry): boolean {
  return hasAvailableCatalogUpdate(entry) && !entry.catalogTarget?.policyBlocked
    && !packageJobActive(entry.packageJob) && !isLocalDevelopmentRunActive(entry.run?.state ?? null);
}

function packageJobActive(job: AppsActionEntry['packageJob']): boolean {
  return job !== null && ![
    AppPackageJobPhase.COMPLETED,
    AppPackageJobPhase.FAILED,
    AppPackageJobPhase.CANCELED,
  ].includes(job.phase);
}

export function canRequestUninstall(entry: AppsActionEntry): boolean {
  return Boolean(entry.committedRelease?.sourceClass === AppPackageSourceClass.VERIFIED && !entry.localDevelopment && !packageJobActive(entry.packageJob));
}
