export type DesktopShutdownFailure = Readonly<{ operation: string; reason: string }>;
export type DesktopShutdownReport = Readonly<{
  criticalCleanupComplete: boolean;
  criticalFailures: readonly DesktopShutdownFailure[];
  diagnostics: readonly DesktopShutdownFailure[];
}>;
export class DesktopShutdownBlockedError extends Error {
  constructor(readonly report: DesktopShutdownReport) { super('desktop-critical-shutdown-failed'); }
}
export type DesktopShutdownStep = Readonly<{
  operation: string; critical: boolean; timeoutMs: number; run: () => unknown | Promise<unknown>;
  abortRemainingOnFailure?: boolean;
}>;

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-006
// The installer must consume this report, not promise resolution or quit.
export async function runDesktopShutdownSteps(steps: readonly DesktopShutdownStep[]): Promise<DesktopShutdownReport> {
  const criticalFailures: DesktopShutdownFailure[] = [], diagnostics: DesktopShutdownFailure[] = [];
  for (const step of steps) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(step.run),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), step.timeoutMs);
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reason = message === 'timeout' ? 'timeout' : /^[a-z][a-z0-9-]{0,127}$/u.test(message) ? message : 'cleanup-failed';
      (step.critical ? criticalFailures : diagnostics).push({ operation: step.operation, reason });
      // Preserve unclosed critical owners. Do not dispose their bridge after
      // a failed App stop or data flush; a retry still needs that owner.
      if (step.critical && step.abortRemainingOnFailure !== false) break;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return { criticalCleanupComplete: criticalFailures.length === 0, criticalFailures, diagnostics };
}
