import { invoke } from '@tauri-apps/api/core';

/**
 * Per-child vision follow-up cadence configuration.
 *
 * Mirrors the `vision_followup_settings` row defined in
 * `spec/kernel/tables/local-storage.yaml`. Absence of a row is meaningful:
 * `getVisionFollowupSettings` returns null, the renderer interprets that as
 * "use the system-recommended default cadence".
 */
export interface VisionFollowupSettings {
  childId: string;
  /** Recurring cadence in months. Spec-bounded to [1, 36]; values outside
   *  this range are rejected by the bridge and never reach SQLite. */
  cadenceMonths: number;
  /** Optional ISO 8601 date (YYYY-MM-DD) that overrides ONLY the next
   *  scheduled visit. After that date passes, the cadence resumes from the
   *  most recent exam date. */
  customNextDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export const VISION_FOLLOWUP_CADENCE_MIN = 1;
export const VISION_FOLLOWUP_CADENCE_MAX = 36;
export const VISION_FOLLOWUP_CADENCE_DEFAULT = 3;

export function getVisionFollowupSettings(childId: string) {
  return invoke<VisionFollowupSettings | null>('get_vision_followup_settings', { childId });
}

export function setVisionFollowupSettings(params: {
  childId: string;
  cadenceMonths: number;
  customNextDate: string | null;
  now: string;
}) {
  return invoke<void>('set_vision_followup_settings', params);
}

export function clearVisionFollowupSettings(childId: string) {
  return invoke<void>('clear_vision_followup_settings', { childId });
}
