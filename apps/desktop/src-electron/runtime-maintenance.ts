import { NIMI_RUNTIME_STORED_DATA_UNSUPPORTED } from '@nimiplatform/kit/shell/electron/main';

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
