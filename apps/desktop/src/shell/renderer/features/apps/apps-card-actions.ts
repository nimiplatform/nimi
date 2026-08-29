// Desktop Apps action projection for the current local-development source.
// Package actions remain absent because local_development never enters the
// immutable package lifecycle.

export type AppCardActionId = 'details' | 'launch' | 'stop' | 'remove';

export interface AppCardAction {
  readonly id: AppCardActionId;
}

export interface AppCardActionPlan {
  readonly primary: AppCardAction | null;
  readonly secondary: readonly AppCardAction[];
}

const DETAILS: AppCardAction = { id: 'details' };
const LAUNCH: AppCardAction = { id: 'launch' };
const STOP: AppCardAction = { id: 'stop' };
const REMOVE: AppCardAction = { id: 'remove' };
const TERMINAL_RUN_STATES = Object.freeze([
  'stopped',
  'failed',
  'build-failed',
  'cleanup-failed',
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
