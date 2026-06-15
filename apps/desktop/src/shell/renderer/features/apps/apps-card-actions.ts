// Apps card actions (T4-W4).
//
// Maps each canonical card state to its primary + secondary actions per
// D-HOME-005 (`Primary action` / `Secondary action`). Every action token here
// routes onto the `desktopAppLifecycleBridge` (the W2d SDK-path bridge) — there is no
// renderer-local lifecycle. `details` is the only renderer-local action (it
// opens the detail/preview view, which is itself a projection of the same
// typed surfaces).
//
// Authority: `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` D-HOME-005.

import type { NimiAppInventoryNextAction } from '@nimiplatform/sdk/app';
import type { CanonicalAppCardState } from './apps-card-state.js';

/**
 * The closed set of app card action tokens. Each maps to one
 * `desktopAppLifecycleBridge` call, except `details` (opens the detail view)
 * and `review_permissions` / `delete_app_data` which open dedicated flows.
 */
export type AppCardActionId =
  | 'install'
  | 'open'
  | 'connect_local'
  | 'update'
  | 'repair'
  | 'retry'
  | 'cancel'
  | 'uninstall'
  | 'remove_local_adoption'
  | 'sign_in'
  | 'delete_app_data'
  | 'review_permissions'
  | 'details';

/**
 * A resolved card action — the id plus whether it is destructive (drives the
 * danger tone + the confirm flow). `bridgeMethod` names the
 * `DesktopAppLifecycleBridge` method the action routes onto, or `null` for the
 * renderer-only `details` / `review_permissions` flows.
 */
export interface AppCardAction {
  readonly id: AppCardActionId;
  readonly destructive: boolean;
}

/** Primary + secondary action plan for a card state. */
export interface AppCardActionPlan {
  /** The single primary action, or `null` for `None`-primary states. */
  readonly primary: AppCardAction | null;
  /** The secondary actions, in display order. */
  readonly secondary: readonly AppCardAction[];
}

function action(id: AppCardActionId, destructive = false): AppCardAction {
  return { id, destructive };
}

const DETAILS = action('details');

const NEXT_ACTION_MAP: Record<NimiAppInventoryNextAction, AppCardActionId> = {
  install: 'install',
  open: 'open',
  'connect-local': 'connect_local',
  'review-permissions': 'review_permissions',
  repair: 'repair',
  update: 'update',
  uninstall: 'uninstall',
  'remove-local-adoption': 'remove_local_adoption',
  'sign-in': 'sign_in',
};

const PRIMARY_ACTION_ORDER: readonly AppCardActionId[] = [
  'open',
  'install',
  'connect_local',
  'sign_in',
  'update',
  'repair',
  'review_permissions',
  'retry',
  'cancel',
];

/**
 * The verbatim per-state action plan. Sources, by state:
 *  - `not_installed_installable` : Install        / Details
 *  - `installing`                : Pause/cancel   / Details        (Cancel-when-safe)
 *  - `installed_ready`           : Open           / Details, Uninstall
 *  - `update_available`          : Open|Update    / Details        (Open primary, Update secondary)
 *  - `update_required`           : Update         / Details
 *  - `permission_required`       : Review perms   / Details
 *  - `repair_required`           : Repair         / Details, Data location
 *  - `unsupported_on_this_device`: None           / Details
 *  - `blocked_by_policy`         : None           / Details
 *  - `install_failed`            : Retry          / Details, Remove partial files
 *  - `uninstalling`              : None           / Details
 *
 * `installed_ready` carries `delete_app_data` as a third secondary so the
 * separate destructive "Delete app data" flow is always reachable from a
 * ready card, not only mid-uninstall.
 */
const ACTION_PLANS: Record<CanonicalAppCardState, AppCardActionPlan> = {
  not_installed_installable: {
    primary: action('install'),
    secondary: [DETAILS],
  },
  installing: {
    // "Pause/cancel when safe" — the runtime only exposes cancel; pause is not
    // an admitted lifecycle action, so the in-flight primary is Cancel.
    primary: action('cancel'),
    secondary: [DETAILS],
  },
  installed_ready: {
    primary: action('open'),
    secondary: [DETAILS, action('uninstall'), action('delete_app_data', true)],
  },
  update_available: {
    // Non-breaking update: Open stays the primary, Update is offered too.
    primary: action('open'),
    secondary: [action('update'), DETAILS],
  },
  update_required: {
    primary: action('update'),
    secondary: [DETAILS],
  },
  permission_required: {
    primary: action('review_permissions'),
    secondary: [DETAILS],
  },
  repair_required: {
    primary: action('repair'),
    secondary: [DETAILS],
  },
  unsupported_on_this_device: {
    primary: null,
    secondary: [DETAILS],
  },
  blocked_by_policy: {
    primary: null,
    secondary: [DETAILS],
  },
  install_failed: {
    // "Retry" + "Remove partial files" — Remove partial files is the
    // destructive cleanup, routed through uninstall of the failed release.
    primary: action('retry'),
    secondary: [DETAILS, action('uninstall', true)],
  },
  uninstalling: {
    primary: null,
    secondary: [DETAILS],
  },
};

/** Resolve the primary + secondary action plan for a card state. */
export function actionPlanForCardState(state: CanonicalAppCardState): AppCardActionPlan {
  return ACTION_PLANS[state];
}

export function actionPlanForInventoryEntry(input: {
  readonly nextActions: readonly NimiAppInventoryNextAction[];
  readonly cardState: CanonicalAppCardState;
}): AppCardActionPlan {
  const mapped = mapInventoryActions(input.nextActions);
  if (mapped.length === 0) {
    return ACTION_PLANS[input.cardState];
  }

  const primaryId = PRIMARY_ACTION_ORDER.find((candidate) => mapped.includes(candidate)) ?? null;
  const secondaryIds = mapped.filter((candidate) => candidate !== primaryId);
  if (!secondaryIds.includes('details')) {
    secondaryIds.unshift('details');
  }
  if (
    input.cardState === 'installed_ready'
    && mapped.includes('uninstall')
    && !secondaryIds.includes('delete_app_data')
  ) {
    secondaryIds.push('delete_app_data');
  }

  return {
    primary: primaryId ? actionForId(primaryId) : null,
    secondary: secondaryIds.map((id) => actionForId(id)),
  };
}

function mapInventoryActions(nextActions: readonly NimiAppInventoryNextAction[]): AppCardActionId[] {
  const seen = new Set<AppCardActionId>();
  const result: AppCardActionId[] = [];
  for (const nextAction of nextActions) {
    const mapped = NEXT_ACTION_MAP[nextAction];
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    result.push(mapped);
  }
  return result;
}

function actionForId(id: AppCardActionId): AppCardAction {
  return action(id, id === 'delete_app_data');
}
