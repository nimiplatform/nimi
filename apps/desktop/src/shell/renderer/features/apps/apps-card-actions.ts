// Desktop Apps action projection.
//
// The 0K Apps surface is read-only. Positive package lifecycle and launch are
// not renderer actions. The only card actions are details and the shell-owned
// account sign-in route.

import type { NimiAppInventoryEntry } from '@nimiplatform/sdk/app';

export type AppCardActionId = 'sign_in' | 'details';

export interface AppCardAction {
  readonly id: AppCardActionId;
}

export interface AppCardActionPlan {
  readonly primary: AppCardAction | null;
  readonly secondary: readonly AppCardAction[];
}

const DETAILS: AppCardAction = { id: 'details' };
const SIGN_IN: AppCardAction = { id: 'sign_in' };

export function actionPlanForInventoryEntry(entry: NimiAppInventoryEntry): AppCardActionPlan {
  if (entry.openReadiness === 'sign-in-required') {
    return { primary: SIGN_IN, secondary: [DETAILS] };
  }
  return { primary: null, secondary: [DETAILS] };
}
