import { AppPackageJobPhase, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

export type AppCardActionId = 'details' | 'install' | 'launch' | 'stop' | 'remove' | 'cancel-job';

export interface AppCardAction {
  readonly id: AppCardActionId;
}

export interface AppCardActionPlan {
  readonly primary: AppCardAction | null;
  readonly secondary: readonly AppCardAction[];
}

type AppsActionEntry = {
  readonly catalogTarget: { readonly policyBlocked: boolean } | null;
  readonly committedRelease: unknown | null;
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
    : { primary: null, secondary: [DETAILS] };
  return entry.packageJob?.cancelable
    ? { ...base, secondary: [...base.secondary, CANCEL_JOB] }
    : base;
}

export function canRequestCatalogInstall(entry: AppsActionEntry): boolean {
  const packageJobActive = entry.packageJob !== null && ![
    AppPackageJobPhase.COMPLETED,
    AppPackageJobPhase.FAILED,
    AppPackageJobPhase.CANCELED,
  ].includes(entry.packageJob.phase);
  return Boolean(entry.catalogTarget && !entry.catalogTarget.policyBlocked && !entry.committedRelease && !packageJobActive);
}
