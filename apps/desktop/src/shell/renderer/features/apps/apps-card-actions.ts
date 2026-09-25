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

/** One in-flight Apps operation, bound to the exact source entry it acts on. */
export interface AppsPendingAction {
  readonly entryKey: string;
  readonly appId: string;
  readonly action: AppCardActionId;
}

/**
 * An operation locks only its own App, across every source of that App, so
 * other Apps stay usable while one launches or stops. Install and update share
 * the single confirmation intent, so while one is in flight every App waits.
 */
export function appsActionsLocked(pending: readonly AppsPendingAction[], appId: string): boolean {
  return pending.some((item) => item.appId === appId || item.action === 'install' || item.action === 'update');
}

export function pendingActionForEntry(pending: readonly AppsPendingAction[], entryKey: string): AppCardActionId | null {
  return pending.find((item) => item.entryKey === entryKey)?.action ?? null;
}

export function pendingActionForApp(pending: readonly AppsPendingAction[], appId: string): AppCardActionId | null {
  return pending.find((item) => item.appId === appId)?.action ?? null;
}

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
    : isInstalledPackage(entry) && (!packageJobActive(entry.packageJob) || isLocalDevelopmentRunActive(entry.run?.state ?? null))
      ? { primary: entry.catalogTarget?.policyBlocked && !isLocalDevelopmentRunActive(entry.run?.state ?? null) ? null : LAUNCH,
          secondary: isLocalDevelopmentRunActive(entry.run?.state ?? null) ? [DETAILS, STOP] : canRequestLocalPackageUpdate(entry) ? [DETAILS, { id: 'update' as const }] : [DETAILS] }
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
  return Boolean(isInstalledPackage(entry) && !entry.localDevelopment && !packageJobActive(entry.packageJob));
}

function isInstalledPackage(entry: AppsActionEntry): boolean {
  return entry.committedRelease?.sourceClass === AppPackageSourceClass.VERIFIED || entry.committedRelease?.sourceClass === AppPackageSourceClass.USER_IMPORTED;
}
export function canRequestLocalPackageUpdate(entry: AppsActionEntry): boolean {
  return entry.committedRelease?.sourceClass === AppPackageSourceClass.USER_IMPORTED && !entry.localDevelopment && !packageJobActive(entry.packageJob) && !isLocalDevelopmentRunActive(entry.run?.state ?? null);
}
