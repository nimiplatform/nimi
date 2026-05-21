// Apps card actions (T4-W4).
//
// Maps each canonical card state to its primary + secondary actions, verbatim
// from the manual `#### Canonical Card States` table (`Primary action` /
// `Secondary action` columns). Every action token here routes onto the
// `desktopAppLifecycleBridge` (the W2d SDK-path bridge) — there is no
// renderer-local lifecycle. `details` is the only renderer-local action (it
// opens the detail/preview view, which is itself a projection of the same
// typed surfaces).
//
// Authority: manual Apps `#### Canonical Card States`; App Card Fields table
// (`Primary action` / `Secondary actions` rows).

import type { CanonicalAppCardState } from './apps-card-state.js';

/**
 * The closed set of app card action tokens. Each maps to one
 * `desktopAppLifecycleBridge` call, except `details` (opens the detail view)
 * and `review_permissions` / `delete_app_data` which open dedicated flows.
 */
export type AppCardActionId =
  | 'install'
  | 'open'
  | 'update'
  | 'repair'
  | 'retry'
  | 'cancel'
  | 'uninstall'
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
 * separate destructive "Delete app data" flow (manual `#### Uninstall And
 * Data`) is always reachable from a ready card, not only mid-uninstall.
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
