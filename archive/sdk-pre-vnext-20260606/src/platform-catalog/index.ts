export {
  PLATFORM_AI_PROFILE_FACTORY_CATALOG,
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  PLATFORM_NIMI_APP_REGISTRY_ROWS,
  PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
  loadPlatformAIProfileFactoryCatalog,
  loadPlatformAIProfileFactoryRows,
  loadPlatformNimiAppRegistryRows,
  loadPlatformNimiAppReleaseDescriptorRows,
} from './generated.js';
export {
  isAdmittedFirstRunLocalBaseline,
  selectFactoryAIProfileForFirstRun,
} from './first-run.js';

export type {
  PlatformAIProfileFactoryRow,
  PlatformNimiAppReleaseDescriptorRow,
} from './generated.js';
export type { FirstRunInstallLevel } from './first-run.js';
