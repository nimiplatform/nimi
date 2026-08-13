/**
 * Support surface sub-area enumeration (`rule.nimi.desktop.product-surfaces.r023`).
 *
 * The `Support` secondary surface hosts exactly — and only — these four
 * sub-areas, in this order. Adding an ordinary preference section here, or a
 * developer-tool entry, violates `rule.nimi.desktop.product-surfaces.r023`.
 */

export type SupportSectionId =
  | 'repair'
  | 'diagnostics'
  | 'logs'
  | 'recovery';

// @nimi-authority: definition.nimi.desktop.product-surfaces.support
// @nimi-authority: rule.nimi.desktop.product-surfaces.r023
/** The canonical, contract-fixed `rule.nimi.desktop.product-surfaces.r023` sub-area set, in render order. */
export const SUPPORT_SECTION_IDS: readonly SupportSectionId[] = [
  'repair',
  'diagnostics',
  'logs',
  'recovery',
] as const;

/** i18n key for each sub-area's sidebar label. */
export const SUPPORT_SECTION_LABEL_KEY: Record<SupportSectionId, string> = {
  repair: 'Support.sectionRepair',
  diagnostics: 'Support.sectionDiagnostics',
  logs: 'Support.sectionLogs',
  recovery: 'Support.sectionRecovery',
};

/**
 * Sub-areas that must stay reachable under a degraded / fail-closed product
 * state (`rule.nimi.desktop.product-surfaces.r029`). Repair and recovery are the user's first-class recovery
 * entries and may never depend on ordinary shell readiness.
 */
export const SUPPORT_DEGRADED_REACHABLE_SECTIONS: readonly SupportSectionId[] = [
  'repair',
  'recovery',
] as const;

export function isSupportSectionId(value: unknown): value is SupportSectionId {
  return typeof value === 'string' && SUPPORT_SECTION_IDS.includes(value as SupportSectionId);
}

/** Resolve the persisted / requested section to a valid `rule.nimi.desktop.product-surfaces.r023` sub-area. */
export function resolveSupportSection(value: unknown): SupportSectionId {
  return isSupportSectionId(value) ? value : 'repair';
}
