import type { TesterCapability } from './tester-capabilities.js';

export type TesterUnavailableReason =
  | 'runtime-not-ready'
  | 'ai-config-binding-missing'
  | 'sdk-surface-missing'
  | 'tauri-command-failed';

export type TesterUnavailable = {
  ok: false;
  capabilityId: string;
  reason: TesterUnavailableReason;
  message: string;
  actionHint: string;
  missingSurface?: string;
};

export function capabilityUnavailable(
  capability: TesterCapability,
  reason: TesterUnavailableReason,
  message: string,
): TesterUnavailable {
  return {
    ok: false,
    capabilityId: capability.id,
    reason,
    message,
    actionHint: reason === 'sdk-surface-missing'
      ? 'Add an admitted SDK Nimi App execution method. Do not bypass Runtime with app-local REST.'
      : reason === 'ai-config-binding-missing'
        ? 'Import/apply an AIProfile or choose a runtime model binding in App Lab AIConfig, then retry.'
        : 'Restore Runtime or standalone Tauri readiness, then retry the lane.',
    missingSurface: capability.missingSurface,
  };
}

export function errorToUnavailable(capability: TesterCapability, reason: TesterUnavailableReason, error: unknown): TesterUnavailable {
  return capabilityUnavailable(
    capability,
    reason,
    error instanceof Error ? error.message : String(error || 'Tester capability is unavailable.'),
  );
}
