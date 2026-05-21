// First-Run Phase Projection — pure presentation projection over the
// product-control state machine.
//
// This module owns NO state-machine truth. It is a one-directional mapping
// from the 12 spec-admitted `ProductControlState` values
// (cold-start-authority-contract P-COLD-009/014,
// tables/first-run-state-machine.yaml) onto the 3 user-facing wizard phases
// plus 3 terminal screens that the redesigned first-run UI renders.
//
// The mapping does not add, collapse, or rename any state-machine state; it
// only decides which phase/screen presents a given state. The fast
// `config_missing` system state folds into the Storage phase as a transient
// loading affordance instead of getting its own boxed screen. `data_root_selected`
// shares the Local AI phase with `ai_environment_unconfigured` and is fully
// interactive — its device-scan evidence loads inline (in the secondary
// "Detected" line) and never blocks the install-level choice.

import type { ProductControlState } from '@renderer/bridge';

/**
 * The three guided wizard phases. Each phase presents exactly one user-action
 * state plus, optionally, one fast system state shown as an inline transient.
 */
export type FirstRunPhase = 'storage' | 'local-ai' | 'setup';

/**
 * The off-happy-path terminal screens. `ready` is the brief confirmation
 * shown for `ready_for_use` before the shell auto-continues to Chat.
 */
export type FirstRunTerminalScreen = 'repair' | 'blocked' | 'ready';

/**
 * What the wizard renders for a given product-control state: either one of
 * the three phases, or one of the terminal screens.
 */
export type FirstRunScreen =
  | { readonly kind: 'phase'; readonly phase: FirstRunPhase }
  | { readonly kind: 'terminal'; readonly screen: FirstRunTerminalScreen };

/**
 * Ordered step-indicator descriptor. The wizard shows a slim 3-segment
 * indicator; only phases participate. Terminal screens carry no active step.
 */
export const FIRST_RUN_PHASES: readonly FirstRunPhase[] = ['storage', 'local-ai', 'setup'];

/**
 * Maps a product-control state onto the wizard screen that presents it.
 *
 * - `config_missing` folds into the Storage phase (transient system step).
 * - `data_root_missing` is the Storage phase user-action state.
 * - `data_root_selected` and `ai_environment_unconfigured` are both the
 *   interactive Local AI phase; the device scan loads inline, never blocking.
 * - the four `local_ai_*` progress/finalization states fold into the single
 *   Setup phase.
 * - `repair_required` / `blocked` / `ready_for_use` are terminal screens.
 * - `not_logged_in` is owned by the auth gate upstream of first-run; if it is
 *   ever observed here it fails closed onto the blocked terminal screen
 *   rather than silently rendering a phase.
 */
export function firstRunScreenForState(state: ProductControlState): FirstRunScreen {
  switch (state) {
    case 'config_missing':
    case 'data_root_missing':
      return { kind: 'phase', phase: 'storage' };
    case 'data_root_selected':
    case 'ai_environment_unconfigured':
      return { kind: 'phase', phase: 'local-ai' };
    case 'local_ai_profile_selected_assets_missing':
    case 'local_ai_profile_selected_environment_not_ready':
    case 'local_ai_assets_downloaded_environment_not_ready':
    case 'local_ai_ready':
      return { kind: 'phase', phase: 'setup' };
    case 'repair_required':
      return { kind: 'terminal', screen: 'repair' };
    case 'blocked':
      return { kind: 'terminal', screen: 'blocked' };
    case 'ready_for_use':
      return { kind: 'terminal', screen: 'ready' };
    case 'not_logged_in':
      return { kind: 'terminal', screen: 'blocked' };
  }
}

/**
 * True when the state is a fast system state that folds into a phase as a
 * transient loading affordance rather than its own user-action screen.
 *
 * - `config_missing`: Nimi is creating `~/.nimi/nimi.json`. Shown as a subtle
 *   loading state inside the Storage phase.
 *
 * `data_root_selected` is deliberately NOT transient: the Local AI phase is
 * interactive as soon as it opens (the install-level cards come from the local
 * factory catalog, not the device scan), and the device-scan evidence loads
 * inline in the secondary "Detected" line without blocking the choice.
 */
export function isTransientSystemState(state: ProductControlState): boolean {
  return state === 'config_missing';
}

/**
 * Whether the active phase should present its content as an inline transient
 * loading state instead of the interactive user-action surface. Used by the
 * Storage phase so the fast `config_missing` system state never gets its own
 * boxed screen.
 */
export function isPhaseTransient(state: ProductControlState): boolean {
  return isTransientSystemState(state);
}
