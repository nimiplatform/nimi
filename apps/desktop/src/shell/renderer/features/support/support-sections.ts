/**
 * Support surface sub-area enumeration (`D-SUP-002`).
 *
 * The `Support` secondary surface hosts exactly — and only — these five
 * sub-areas, in this order. Adding an ordinary preference section here, or a
 * developer-tool entry, violates `D-SUP-002`.
 */

export type SupportSectionId =
  | 'repair'
  | 'updates'
  | 'diagnostics'
  | 'logs'
  | 'recovery';

/** The canonical, contract-fixed `D-SUP-002` sub-area set, in render order. */
export const SUPPORT_SECTION_IDS: readonly SupportSectionId[] = [
  'repair',
  'updates',
  'diagnostics',
  'logs',
  'recovery',
] as const;

/** i18n key for each sub-area's sidebar label. */
export const SUPPORT_SECTION_LABEL_KEY: Record<SupportSectionId, string> = {
  repair: 'Support.sectionRepair',
  updates: 'Support.sectionUpdates',
  diagnostics: 'Support.sectionDiagnostics',
  logs: 'Support.sectionLogs',
  recovery: 'Support.sectionRecovery',
};

const SUPPORT_SECTION_SET = new Set<SupportSectionId>(SUPPORT_SECTION_IDS);

/**
 * Sub-areas that must stay reachable under a degraded / fail-closed product
 * state (`D-SUP-008`). Repair and recovery are the user's first-class recovery
 * entries and may never depend on ordinary shell readiness.
 */
export const SUPPORT_DEGRADED_REACHABLE_SECTIONS: readonly SupportSectionId[] = [
  'repair',
  'recovery',
] as const;

export function isSupportSectionId(value: unknown): value is SupportSectionId {
  return typeof value === 'string' && SUPPORT_SECTION_SET.has(value as SupportSectionId);
}

/** Resolve the persisted / requested section to a valid `D-SUP-002` sub-area. */
export function resolveSupportSection(value: unknown): SupportSectionId {
  return isSupportSectionId(value) ? value : 'repair';
}
