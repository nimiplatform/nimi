import { NIMI_RUNTIME_STORED_DATA_UNSUPPORTED, type NimiElectronRuntimeLifecycleHost } from '@nimiplatform/kit/shell/electron/main';

export { NIMI_RUNTIME_STORED_DATA_UNSUPPORTED };

// @nimi-authority: rule.nimi.desktop.shell-runtime.r025
/**
 * Reads whether the Runtime serves only its maintenance surface, from the
 * typed lifecycle status. Any failure to read it is not maintenance: the
 * ordinary bootstrap then reports its own state.
 */
export async function readDesktopRuntimeMaintenance(readStatus: () => Promise<unknown>): Promise<boolean> {
  try {
    return runtimeStatusIsMaintenance(await readStatus());
  } catch {
    return false;
  }
}

export function runtimeStatusIsMaintenance(status: unknown): boolean {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  const record = status as Readonly<Record<string, unknown>>;
  return record.running !== true && record.lastError === NIMI_RUNTIME_STORED_DATA_UNSUPPORTED;
}

export type WindowsHomeRuntimeStart =
  | { kind: 'deferred' | 'ready' | 'maintenance' }
  | { kind: 'failed'; error: unknown };

// The native start joins an already-running/starting service and verifies its
// protected peer. The caller shares this promise across Electron readiness.
export async function startWindowsHomeRuntime(
  hasPendingUpdate: () => Promise<boolean>,
  start: () => Promise<{ running: boolean; lastError?: string }>,
): Promise<WindowsHomeRuntimeStart> {
  try {
    if (await hasPendingUpdate()) return { kind: 'deferred' };
    const status = await start();
    if (status.running) return { kind: 'ready' };
    if (runtimeStatusIsMaintenance(status)) return { kind: 'maintenance' };
    throw new Error(status.lastError || 'runtime-service-unavailable');
  } catch (error) {
    return { kind: 'failed', error };
  }
}

// Spend one pre-ready budget on service preparation and the protected scope
// read together. A slow native start remains owned by the ready-phase caller.
export async function readStartupHomeProfileScope(
  preparation: Promise<WindowsHomeRuntimeStart> | undefined,
  readScope: () => Promise<string>,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const timeoutError = () => new Error('desktop-home-profile-scope-read-timeout');
  try {
    return await Promise.race([
      (async () => {
        const started = await preparation;
        if (expired) throw timeoutError();
        if (started?.kind === 'failed') throw started.error;
        if (started?.kind === 'maintenance') throw new Error(NIMI_RUNTIME_STORED_DATA_UNSUPPORTED);
        return readScope();
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => { expired = true; reject(timeoutError()); },
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// A fixed service can finish cold startup after Home's first probe. Keep the
// main-process gate in step with later authenticated status reads by the shell.
export function observeDesktopRuntimeMaintenance(
  lifecycle: NimiElectronRuntimeLifecycleHost,
  enterMaintenance: () => void,
): NimiElectronRuntimeLifecycleHost {
  return {
    stop: () => lifecycle.stop(),
    async invoke(command, names) {
      const status = await lifecycle.invoke(command, names);
      if (runtimeStatusIsMaintenance(status)) enterMaintenance();
      return status;
    },
  };
}
