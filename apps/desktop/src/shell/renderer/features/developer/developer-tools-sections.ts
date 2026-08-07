/**
 * Developer Tools surface sub-area enumeration (`D-DEV-003`).
 *
 * The `Developer Tools` developer-group surface hosts only developer-mode
 * technical content: local-development registration/activity and a
 * diagnostics route into Support. It MUST NOT host ordinary-user product
 * functionality (`D-DEV-003` MUST NOT).
 */

export type DeveloperToolsSectionId = 'local-development' | 'diagnostics';

/** The canonical, contract-fixed `D-DEV-003` sub-area set, in render order. */
export const DEVELOPER_TOOLS_SECTION_IDS: readonly DeveloperToolsSectionId[] = [
  'local-development',
  'diagnostics',
] as const;

/** i18n key for each sub-area's sidebar label. */
export const DEVELOPER_TOOLS_SECTION_LABEL_KEY: Record<DeveloperToolsSectionId, string> = {
  'local-development': 'DeveloperTools.sectionLocalDevelopment',
  diagnostics: 'DeveloperTools.sectionDiagnostics',
};

export function isDeveloperToolsSectionId(value: unknown): value is DeveloperToolsSectionId {
  return typeof value === 'string'
    && DEVELOPER_TOOLS_SECTION_IDS.includes(value as DeveloperToolsSectionId);
}

/** Resolve the persisted / requested section to a valid `D-DEV-003` sub-area. */
export function resolveDeveloperToolsSection(value: unknown): DeveloperToolsSectionId {
  return isDeveloperToolsSectionId(value) ? value : 'local-development';
}
