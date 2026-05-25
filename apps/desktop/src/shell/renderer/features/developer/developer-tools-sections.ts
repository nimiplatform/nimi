/**
 * Developer Tools surface sub-area enumeration (`D-DEV-003`).
 *
 * The `Developer Tools` developer-group surface hosts exactly — and only —
 * these sub-areas: developer-mode technical diagnostics and the `nimi.tester`
 * developer-only app reference. It MUST NOT host ordinary-user product
 * functionality (`D-DEV-003` MUST NOT).
 */

export type DeveloperToolsSectionId =
  | 'tester'
  | 'diagnostics';

/** The canonical, contract-fixed `D-DEV-003` sub-area set, in render order. */
export const DEVELOPER_TOOLS_SECTION_IDS: readonly DeveloperToolsSectionId[] = [
  'tester',
  'diagnostics',
] as const;

/** i18n key for each sub-area's sidebar label. */
export const DEVELOPER_TOOLS_SECTION_LABEL_KEY: Record<DeveloperToolsSectionId, string> = {
  tester: 'DeveloperTools.sectionTester',
  diagnostics: 'DeveloperTools.sectionDiagnostics',
};

const DEVELOPER_TOOLS_SECTION_SET = new Set<DeveloperToolsSectionId>(DEVELOPER_TOOLS_SECTION_IDS);

export function isDeveloperToolsSectionId(value: unknown): value is DeveloperToolsSectionId {
  return typeof value === 'string'
    && DEVELOPER_TOOLS_SECTION_SET.has(value as DeveloperToolsSectionId);
}

/** Resolve the persisted / requested section to a valid `D-DEV-003` sub-area. */
export function resolveDeveloperToolsSection(value: unknown): DeveloperToolsSectionId {
  return isDeveloperToolsSectionId(value) ? value : 'tester';
}
