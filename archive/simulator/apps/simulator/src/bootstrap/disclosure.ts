/**
 * Static bootstrap disclosure ownership. The HTML status exists before any
 * JavaScript or CSS executes; these helpers only move it from starting to a
 * fixed terminal failure, or remove it after the real Shell status commits.
 *
 * Authority: P-SIM-001 and P-SIM-019.
 */

export const SIMULATOR_BOOTSTRAP_STATUS_ID = 'simulator-bootstrap-status';
export const SIMULATOR_BOOTSTRAP_STATE_ID = 'simulator-bootstrap-state';
export const SIMULATOR_BOOTSTRAP_FAILURE_CODE = 'SIMULATOR_INTEGRITY_FAILURE';
export const SIMULATOR_BOOTSTRAP_FAILURE_TEXT = 'Simulator session failed to start.';

export function markSimulatorBootstrapFailure(document: Document): void {
  const status = document.getElementById(SIMULATOR_BOOTSTRAP_STATUS_ID);
  const state = document.getElementById(SIMULATOR_BOOTSTRAP_STATE_ID);
  const root = document.getElementById('root');
  status?.setAttribute('data-simulator-phase', 'terminal');
  status?.setAttribute('data-simulator-failure-code', SIMULATOR_BOOTSTRAP_FAILURE_CODE);
  status?.setAttribute('aria-live', 'assertive');
  if (state) state.textContent = SIMULATOR_BOOTSTRAP_FAILURE_TEXT;
  root?.setAttribute('aria-busy', 'false');
}

export function completeSimulatorBootstrapDisclosure(document: Document): void {
  const status = document.getElementById(SIMULATOR_BOOTSTRAP_STATUS_ID);
  const root = document.getElementById('root');
  root?.setAttribute('aria-busy', 'false');
  status?.remove();
}

/** Converts every bootstrap fault to one fixed, non-sensitive terminal status. */
export async function startSimulator(
  bootstrap: () => Promise<void>,
  document: Document = globalThis.document,
): Promise<void> {
  try {
    await bootstrap();
  } catch {
    markSimulatorBootstrapFailure(document);
  }
}
