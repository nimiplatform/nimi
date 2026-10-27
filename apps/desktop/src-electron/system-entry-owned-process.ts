import type { ChildProcess } from 'node:child_process';

export function systemEntryOwnedProcessAlive(child: ChildProcess | undefined): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

/** Confirm the exit of this exact owned helper; a sent signal is not exit. */
// @nimi-authority: rule.nimi.desktop.shell-ui.r066
export async function stopSystemEntryOwnedProcess(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (!systemEntryOwnedProcessAlive(child)) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener('exit', onExit); child.removeListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onExit = (): void => finish();
    const onError = (error: Error): void => finish(new Error('desktop-owned-process-stop-failed', { cause: error }));
    child.once('exit', onExit); child.once('error', onError);
    const timer = setTimeout(() => finish(new Error('desktop-owned-process-stop-timeout')), timeoutMs);
    try {
      child.kill();
      if (!systemEntryOwnedProcessAlive(child)) finish();
    } catch (error) { finish(new Error('desktop-owned-process-stop-failed', { cause: error })); }
  });
}
