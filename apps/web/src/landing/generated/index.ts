/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: 639e1efe3ad8e9f7ee28104301e256f15e712f6c0dae9658e34703868a98427b
 *   config/runtime-provider-capabilities.yaml
 *     sha256: a14dacf51b220fef2e0636b89abd1be22c0f7f906d3046b6dd1d50119c82c609
 *   runtime/catalog/providers/local.yaml
 *     sha256: fbf9079ab442ec1148e107d55eb18e8019a98db8538b51f518de1861a9606492
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
