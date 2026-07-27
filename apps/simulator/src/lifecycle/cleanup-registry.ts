/**
 * Instance host cleanup registry: registration windows, one-shot reverse
 * order cleanup, and the fixed host-integrity watchdog.
 *
 * Authority: P-SIM-013 (the retired SIM-PROTO-012/013 cleanup rules map
 * onto it) and tables/simulator-state-engine-policy.yaml
 * `instance_lifecycle`.
 * Cleanup runs once in reverse registration order, is awaited serially, and
 * every rejection or watchdog timeout is a session integrity failure.
 */

import { simulatorError, type SimulatorResult, simulatorOk, simulatorFail } from '../state-engine/errors.ts';

export interface SimulatorHostTimers {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const SIMULATOR_CLEANUP_WATCHDOG_MS = 5000;

export interface SimulatorCleanupRegistryOptions {
  readonly instanceId: string;
}

export type SimulatorCleanupPhase = 'open' | 'closed-window' | 'running' | 'completed';

/**
 * Registration is open only during the synchronous prefix of `prepare` or
 * `activate`; the lifecycle host opens and closes each window. Registration
 * outside a window fails conformance.
 */
export interface SimulatorCleanupRegistry {
  add(dispose: () => Promise<void> | void): SimulatorResult<{ readonly registrationId: string }>;
  readonly phase: SimulatorCleanupPhase;
  readonly registrationCount: number;
}

export interface SimulatorCleanupController {
  readonly registry: SimulatorCleanupRegistry;
  beginWindow(): void;
  closeWindow(): void;
  /** Runs every registered cleanup once in reverse order, awaited serially. */
  run(timers: SimulatorHostTimers, watchdogMs?: number): Promise<{ readonly ok: boolean }>;
  readonly ran: boolean;
}

export function createCleanupRegistry(options: SimulatorCleanupRegistryOptions): SimulatorCleanupController {
  const entries: { readonly registrationId: string; readonly dispose: () => Promise<void> | void }[] = [];
  let windowOpen = false;
  let phase: SimulatorCleanupPhase = 'closed-window';
  let ran = false;
  let runPromise: Promise<{ readonly ok: boolean }> | null = null;

  return {
    registry: {
      add(dispose) {
        if (ran || phase === 'running' || phase === 'completed') {
          return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
        }
        if (!windowOpen) {
          return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
        }
        const registrationId = `${options.instanceId}:cleanup:${entries.length + 1}`;
        entries.push({ registrationId, dispose });
        return simulatorOk({ registrationId });
      },
      get phase() {
        return phase;
      },
      get registrationCount() {
        return entries.length;
      },
    },
    beginWindow() {
      if (ran || phase === 'running' || phase === 'completed') return;
      windowOpen = true;
      phase = 'open';
    },
    closeWindow() {
      windowOpen = false;
      if (!ran && phase !== 'running' && phase !== 'completed') phase = 'closed-window';
    },
    run(timers, watchdogMs = SIMULATOR_CLEANUP_WATCHDOG_MS) {
      if (runPromise) return runPromise;
      ran = true;
      phase = 'running';
      windowOpen = false;
      const reversed = entries.slice().reverse();
      runPromise = (async () => {
        const outcome = await runWithWatchdog(async () => {
          let failed = false;
          for (const entry of reversed) {
            try {
              await entry.dispose();
            } catch {
              // Resource integrity is already lost, but later reverse-order
              // cleanup still gets one attempt before the session fails closed.
              failed = true;
            }
          }
          if (failed) throw new Error('SIMULATOR_CLEANUP_ENTRY_FAILED');
        }, timers, watchdogMs);
        phase = 'completed';
        return { ok: outcome.ok };
      })();
      return runPromise;
    },
    get ran() {
      return ran;
    },
  };
}

/**
 * The watchdog uses host monotonic time only as a fail-closed integrity
 * guard; its elapsed value never enters State Engine state.
 */
export function runWithWatchdog(
  work: () => Promise<void> | void,
  timers: SimulatorHostTimers,
  watchdogMs: number,
): Promise<{ readonly ok: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = timers.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false });
      }
    }, watchdogMs);
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      resolve({ ok });
    };
    try {
      const result = work();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(() => finish(true), () => finish(false));
      } else {
        finish(true);
      }
    } catch {
      finish(false);
    }
  });
}
