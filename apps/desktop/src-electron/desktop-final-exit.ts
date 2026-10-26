type DesktopExitRuntimeBridge = Readonly<{ unregister(): void }>;

// @nimi-authority: rule.nimi.desktop.shell-ui.r066
// Critical cleanup runs before this terminal boundary. Ordinary quit reaches
// will-quit only after every window closed; app.exit skips that event entirely.
export function createDesktopFinalExit(input: {
  takeRuntimeBridge(): DesktopExitRuntimeBridge | undefined;
  reportDiagnostic(reason: string): void;
  exit(code: number): void;
}) {
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    try {
      input.takeRuntimeBridge()?.unregister();
    } catch (error) {
      // Match the existing non-critical Desktop shutdown diagnostic policy.
      const message = error instanceof Error ? error.message : '';
      input.reportDiagnostic(/^[a-z][a-z0-9-]{0,127}$/u.test(message) ? message : 'cleanup-failed');
    }
  };
  return Object.freeze({
    finish,
    exit(code: number): void {
      // Never yield after removing the handler while a renderer can still run.
      try { finish(); } finally { input.exit(code); }
    },
  });
}
