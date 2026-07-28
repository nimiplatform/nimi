// Desktop Apps action projection.
//
// The current local-development Apps surface is read-only. Launch remains with
// the supervised App Tools flow, and public package lifecycle is deferred.

export type AppCardActionId = 'details';

export interface AppCardAction {
  readonly id: AppCardActionId;
}

export interface AppCardActionPlan {
  readonly primary: AppCardAction | null;
  readonly secondary: readonly AppCardAction[];
}

const DETAILS: AppCardAction = { id: 'details' };

export function actionPlanForLocalDevelopmentEntry(): AppCardActionPlan {
  return { primary: null, secondary: [DETAILS] };
}
