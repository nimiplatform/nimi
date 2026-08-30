export type DesktopDataRootOperationGate = {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  runDiagnostic<T>(operation: () => Promise<T>): Promise<T>;
  close(reason: string): void;
  open(): void;
  isClosed(): boolean;
};

export function createDesktopDataRootOperationGate(): DesktopDataRootOperationGate {
  let tail: Promise<void> = Promise.resolve();
  let closedReason: string | null = null;
  const enqueue = <T>(operation: () => Promise<T>, requireOpen: boolean): Promise<T> => {
    const admitted = (): Promise<T> => {
      if (requireOpen && closedReason) throw new Error(closedReason);
      return operation();
    };
    const result = tail.then(admitted, admitted);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return Object.freeze({
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return enqueue(operation, true);
    },
    runDiagnostic<T>(operation: () => Promise<T>): Promise<T> {
      return enqueue(operation, false);
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
