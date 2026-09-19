import type { RuntimePageIdV11 } from './runtime-config-state-types';

/**
 * The Runtime surface has exactly four text destinations, rendered through
 * the registered Kit navigation primitive (NimiTabs). Labels resolve through
 * `labelKey`; the `label` field is the English fallback.
 */
export const RUNTIME_NAV_DESTINATIONS: ReadonlyArray<{
  id: RuntimePageIdV11;
  label: string;
  labelKey: string;
}> = [
  { id: 'aiSettings', label: 'AI Settings', labelKey: 'runtimeConfig.nav.aiSettings' },
  { id: 'modelLibrary', label: 'Model Library', labelKey: 'runtimeConfig.nav.modelLibrary' },
  { id: 'cloudServices', label: 'Cloud Services', labelKey: 'runtimeConfig.nav.cloudServices' },
  { id: 'advancedDiagnostics', label: 'Advanced & Diagnostics', labelKey: 'runtimeConfig.nav.advancedDiagnostics' },
];
