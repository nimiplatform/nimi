import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';

export const EXECUTION_NOTIFICATION_PREFERENCES_PATH = 'execution-notices/preferences.v1.json';
export const EXECUTION_NOTIFICATION_MUTATION_SCOPE = 'desktop-execution-notification-preferences';
export const EXECUTION_NOTIFICATION_PAUSE_MS = 60 * 60 * 1000;

export type ExecutionNotificationPreferences = Readonly<{
  systemEnabled: boolean;
  pausedUntil?: number;
}>;
export type ExecutionNotificationPreferenceChange =
  | Readonly<{ kind: 'system'; enabled: boolean }>
  | Readonly<{ kind: 'pause' }>
  | Readonly<{ kind: 'resume' }>;
export type ExecutionNotificationStorage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;

export function parseExecutionNotificationPreferences(value: unknown): ExecutionNotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Execution notification preferences are invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['version', 'systemEnabled', 'pausedUntil'].includes(key))
    || record.version !== 1 || typeof record.systemEnabled !== 'boolean'
    || (record.pausedUntil !== undefined && (typeof record.pausedUntil !== 'number'
      || !Number.isSafeInteger(record.pausedUntil) || record.pausedUntil < 0
      || !Number.isFinite(new Date(record.pausedUntil).getTime())))) {
    throw new Error('Execution notification preferences are invalid');
  }
  return { systemEnabled: record.systemEnabled, ...(record.pausedUntil === undefined ? {} : { pausedUntil: record.pausedUntil as number }) };
}

export async function readExecutionNotificationPreferences(storage: ExecutionNotificationStorage): Promise<ExecutionNotificationPreferences> {
  try {
    const { value } = await storage.readJson(EXECUTION_NOTIFICATION_PREFERENCES_PATH);
    return parseExecutionNotificationPreferences(value);
  } catch (error) {
    const reason = error && typeof error === 'object' && 'reasonCode' in error ? error.reasonCode : '';
    if (reason === 'APP_STORAGE_ENTRY_NOT_FOUND') return { systemEnabled: true };
    throw error;
  }
}

/** Called only inside the shared React Query mutation scope. */
// @nimi-authority: rule.nimi.desktop.product-surfaces.execution-notice
export async function changeExecutionNotificationPreferences(
  storage: ExecutionNotificationStorage,
  change: ExecutionNotificationPreferenceChange,
  assertCurrent: () => void,
  now = Date.now,
): Promise<ExecutionNotificationPreferences> {
  assertCurrent();
  const previous = await readExecutionNotificationPreferences(storage);
  assertCurrent();
  const next: ExecutionNotificationPreferences = change.kind === 'system'
    ? { ...previous, systemEnabled: change.enabled }
    : change.kind === 'pause'
      ? { ...previous, pausedUntil: now() + EXECUTION_NOTIFICATION_PAUSE_MS }
      : { systemEnabled: previous.systemEnabled };
  await storage.writeJson(EXECUTION_NOTIFICATION_PREFERENCES_PATH, { version: 1, ...next });
  assertCurrent();
  return next;
}
