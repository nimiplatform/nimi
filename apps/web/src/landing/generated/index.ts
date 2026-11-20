/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: 639e1efe3ad8e9f7ee28104301e256f15e712f6c0dae9658e34703868a98427b
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 90b40c5728131cbca400b20c5fb231448155b7da8e369b8c18f2f1f53bbc0daf
 *   runtime/catalog/providers/local.yaml
 *     sha256: 46ee521d5fd9b2d1676cf69df3aac8961380b35be11a8b051e28dd3b17c9811e
 * Generator: apps/web/scripts/generate-landing-data.mjs
 * DO NOT EDIT MANUALLY. Re-run generator (`pnpm prebuild` or
 * `node scripts/generate-landing-data.mjs` from apps/web/) to refresh.
 */

export type {
  AdmittedInventoryMode,
  AdmittedProvider,
} from './admitted-providers.js';
export { ADMITTED_PROVIDERS } from './admitted-providers.js';

export type {
  AdmittedRuntimePlane,
  AdmittedEndpointRequirement,
  AdmittedCapability,
  ProviderCapability,
} from './provider-capabilities.js';
export {
  ADMITTED_CAPABILITIES,
  PROVIDER_CAPABILITIES,
} from './provider-capabilities.js';

export type { LocalCapabilityModel } from './local-model-catalog.js';
export { LOCAL_MODEL_CATALOG } from './local-model-catalog.js';
