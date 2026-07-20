/**
 * Installs the one bootstrap-attributed global error family through the
 * Shell-owned physical listener coordinator. The callback carries no browser
 * error payload into product state; every event terminates with the fixed
 * Simulator integrity code supplied by the caller.
 *
 * Authority: P-SIM-018, P-SIM-019, simulator-listener-families.yaml.
 */

import type { SimulatorGuardHandle } from '../effects/guards.ts';
import type { SimulatorGlobalCoordinator } from './global-coordinator.ts';

export function installSimulatorIntegrityListener(options: {
  readonly guard: SimulatorGuardHandle;
  readonly coordinator: SimulatorGlobalCoordinator;
  readonly terminate: () => void;
}): void {
  let unsubscribe: (() => void) | null = null;
  const subscribed = options.coordinator.subscribeFamily('integrity_error', () => {
    options.guard.withScope({
      owner: 'simulator-bootstrap',
      phase: 'callback',
    }, () => {
      const release = unsubscribe;
      unsubscribe = null;
      release?.();
      options.terminate();
    });
  });
  if (!subscribed.ok) throw new Error('SIMULATOR_INTEGRITY_LISTENER_UNAVAILABLE');
  unsubscribe = subscribed.value;
}
