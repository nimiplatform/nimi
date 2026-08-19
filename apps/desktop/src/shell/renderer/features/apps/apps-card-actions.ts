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

export function actionPlanForLocalDevelopmentEntry(runState: string | null): AppCardActionPlan {
  const active = runState !== null && !['stopped', 'failed', 'build-failed', 'cleanup-failed', 'project-changed', 'registration-unavailable', 'registration-removed'].includes(runState);
  return {
    primary: active ? STOP : LAUNCH,
    secondary: [DETAILS, REMOVE],
  };
}
