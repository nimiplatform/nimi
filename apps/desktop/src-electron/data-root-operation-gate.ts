// Data-root admission for Home. Root replacement, cleanup, managed App
// launches and Runtime restart are exclusive; ordinary commands and long
// independent calls (a synchronous generation, a transcription, its cancel)
// are shared, so short work never queues behind a long call. Admission is
// FIFO: a waiting exclusive operation stops later shared work from starting,
// then waits for admitted shared work to settle, so every admitted operation
// completes under the root and session it started with.
export type DesktopDataRootOperationGate = {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  runShared<T>(operation: () => Promise<T>): Promise<T>;
  /** Exclusive recovery work that is admitted while the gate is closed. */
  runDiagnostic<T>(operation: () => Promise<T>): Promise<T>;
  /** Read-only diagnostics admitted while closed and alongside shared work. */
  runSharedDiagnostic<T>(operation: () => Promise<T>): Promise<T>;
  close(reason: string): void;
  open(): void;
  isClosed(): boolean;
};

type Admission = { readonly exclusive: boolean; readonly start: () => void };

export function createDesktopDataRootOperationGate(): DesktopDataRootOperationGate {
  let closedReason: string | null = null;
  let sharedRunning = 0;
  let exclusiveRunning = false;
  const waiting: Admission[] = [];
  const pump = (): void => {
    while (waiting.length > 0 && !exclusiveRunning) {
      const next = waiting[0]!;
      if (next.exclusive) {
        if (sharedRunning > 0) return;
        waiting.shift();
        exclusiveRunning = true;
        next.start();
        return;
      }
      waiting.shift();
      sharedRunning += 1;
      next.start();
    }
  };
  const run = async <T>(exclusive: boolean, requireOpen: boolean, operation: () => Promise<T>): Promise<T> => {
    await new Promise<void>((start) => {
      waiting.push({ exclusive, start });
      pump();
    });
    try {
      // Closure is checked when the operation is admitted, not when queued.
      if (requireOpen && closedReason) throw new Error(closedReason);
      return await operation();
    } finally {
      if (exclusive) exclusiveRunning = false;
      else sharedRunning -= 1;
      pump();
    }
  };
  return Object.freeze({
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return run(true, true, operation);
    },
    runShared<T>(operation: () => Promise<T>): Promise<T> {
      return run(false, true, operation);
    },
    runDiagnostic<T>(operation: () => Promise<T>): Promise<T> {
      return run(true, false, operation);
    },
    runSharedDiagnostic<T>(operation: () => Promise<T>): Promise<T> {
      return run(false, false, operation);
    },
    close(reason: string): void {
      const normalized = String(reason || '').trim();
      closedReason = normalized || 'desktop-data-root-handoff-closed';
    },
    open(): void {
      closedReason = null;
    },
    isClosed(): boolean {
      return closedReason !== null;
    },
  });
}
