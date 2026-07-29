export type DesktopDataRootOperationGate = {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
};

export function createDesktopDataRootOperationGate(): DesktopDataRootOperationGate {
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  });
}
