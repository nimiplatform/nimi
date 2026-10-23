export type DesktopQuitPhase = 'idle' | 'confirming' | 'stopping' | 'committed' | 'system-ending';

export type DesktopQuitCoordinator<TImpact> = {
  phase(): DesktopQuitPhase;
  isLaunchBlocked(): boolean;
  requestUserQuit(): Promise<boolean>;
  beginSystemEnd(): void;
};

export type CreateDesktopQuitCoordinatorInput<TImpact> = {
  readImpact(): Promise<TImpact>;
  confirm(impact: TImpact): Promise<boolean>;
  shutdown(): Promise<void>;
  finishQuit(): Promise<void> | void;
  recoverAfterFailedQuit(error: unknown): Promise<void> | void;
  phaseChanged?(phase: DesktopQuitPhase): void;
};

// @nimi-authority: rule.nimi.desktop.shell-ui.r066
// The owner supplies the real impact and its existing cleanup. This module
// serializes user intent; it does not turn process booleans into App counts,
// restart stopped Apps or weaken update/data-root cleanup requirements.
export function createDesktopQuitCoordinator<TImpact>(
  input: CreateDesktopQuitCoordinatorInput<TImpact>,
): DesktopQuitCoordinator<TImpact> {
  let phase: DesktopQuitPhase = 'idle';
  let intent = 0;
  let inFlight: Promise<boolean> | undefined;

  const setPhase = (next: DesktopQuitPhase): void => {
    phase = next;
    input.phaseChanged?.(next);
  };

  const requestUserQuit = (): Promise<boolean> => {
    if (inFlight) return inFlight;
    if (phase === 'committed') return Promise.resolve(true);
    if (phase === 'system-ending') return Promise.resolve(false);
    const currentIntent = ++intent;
    setPhase('confirming');
    const current = (): boolean => intent === currentIntent && phase !== 'system-ending';
    const attempt = (async (): Promise<boolean> => {
      try {
        const impact = await input.readImpact();
        if (!current()) return false;
        const confirmed = await input.confirm(impact);
        if (!current()) return false;
        if (!confirmed) {
          setPhase('idle');
          return false;
        }
        setPhase('stopping');
        await input.shutdown();
        if (!current()) return false;
        setPhase('committed');
        await input.finishQuit();
        return true;
      } catch (error) {
        // A system session end supersedes the ordinary confirmation and must
        // never reopen windows or wait for a second ordinary quit dialog.
        if (!current()) return false;
        try {
          await input.recoverAfterFailedQuit(error);
        } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], 'desktop-quit-recovery-failed');
        } finally {
          if (current()) setPhase('idle');
        }
        throw error;
      }
    })();
    const tracked = attempt.finally(() => {
      if (inFlight === tracked) inFlight = undefined;
    });
    inFlight = tracked;
    return tracked;
  };

  return Object.freeze({
    phase: () => phase,
    isLaunchBlocked: () => phase !== 'idle',
    requestUserQuit,
    beginSystemEnd(): void {
      intent += 1;
      setPhase('system-ending');
    },
  });
}
