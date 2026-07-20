/** Exact, watchdog-bounded cleanup barrier for one renderer instance. */

import type { SimulatorCanonicalInstance, SimulatorCanonicalRendererBindings } from './renderer-contract.ts';
import type {
  SimulatorAdapterInstance,
  SimulatorPreparedSurfaceHost,
} from './instance-host-contract.ts';
import {
  runWithWatchdog,
  type SimulatorCleanupController,
  type SimulatorHostTimers,
} from './cleanup-registry.ts';

export interface SimulatorInstanceCleanupRecord {
  readonly cleanup: SimulatorCleanupController;
  cleanupCompletion: Promise<boolean> | null;
  pendingPrepare: Promise<SimulatorCanonicalRendererBindings> | null;
  surfaceHost: SimulatorPreparedSurfaceHost | null;
  canonical: SimulatorCanonicalInstance | null;
  adapter: SimulatorAdapterInstance | null;
  surfaceUnmounted: boolean;
  canonicalDisposed: boolean;
  adapterDisposed: boolean;
}

export interface SimulatorInstanceCleanupOptions {
  readonly record: SimulatorInstanceCleanupRecord;
  readonly timers: SimulatorHostTimers;
  readonly watchdogMs: number;
  readonly runRenderer: (callback: () => Promise<void> | void) => Promise<void> | void;
  readonly runAdapter: (callback: () => Promise<void> | void) => Promise<void> | void;
}

export function runSimulatorInstanceCleanup(
  options: SimulatorInstanceCleanupOptions,
): Promise<boolean> {
  const { record } = options;
  if (record.cleanupCompletion) return record.cleanupCompletion;
  record.cleanupCompletion = performSimulatorInstanceCleanup(options);
  return record.cleanupCompletion;
}

async function performSimulatorInstanceCleanup(
  options: SimulatorInstanceCleanupOptions,
): Promise<boolean> {
  const { record } = options;
  const outcome = await runWithWatchdog(async () => {
    let failed = false;
    const attempt = async (work: () => Promise<void> | void): Promise<void> => {
      try {
        await work();
      } catch {
        failed = true;
      }
    };
    const observedPrepare = record.pendingPrepare
      ? record.pendingPrepare.then(() => undefined, () => undefined)
      : Promise.resolve();

    if (!record.surfaceUnmounted && record.surfaceHost) {
      record.surfaceUnmounted = true;
      await attempt(() => record.surfaceHost?.unmount());
    }
    if (record.canonical && !record.canonicalDisposed) {
      record.canonicalDisposed = true;
      await attempt(() => options.runRenderer(() => record.canonical?.dispose()));
    }
    if (record.adapter && !record.adapterDisposed) {
      record.adapterDisposed = true;
      await attempt(() => options.runAdapter(() => record.adapter?.dispose()));
    }
    const cleaned = await record.cleanup.run(options.timers, options.watchdogMs);
    if (!cleaned.ok) failed = true;
    await observedPrepare;
    if (failed) throw new Error('SIMULATOR_OWNED_CLEANUP_FAILED');
  }, options.timers, options.watchdogMs);
  return outcome.ok;
}

export function enqueueWatchdogBoundLifecycleIntent(options: {
  readonly enqueue: (intent: () => Promise<void>) => void;
  readonly intent: () => Promise<void>;
  readonly timers: SimulatorHostTimers;
  readonly watchdogMs: number;
}): Promise<boolean> {
  let abandoned = false;
  let intentFailed = false;
  let resolveCompletion: () => void = () => undefined;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
  options.enqueue(async () => {
    try {
      if (!abandoned) await options.intent();
    } catch {
      intentFailed = true;
    } finally {
      resolveCompletion();
    }
  });
  return runWithWatchdog(() => completion, options.timers, options.watchdogMs).then((outcome) => {
    if (!outcome.ok) abandoned = true;
    return outcome.ok && !intentFailed;
  });
}
