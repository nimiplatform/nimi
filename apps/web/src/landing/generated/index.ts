/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: 3b4cb2d13b487510235c11016deda952e56cbc019eae09c0e985b6b711e7e0d9
 *   config/runtime-provider-capabilities.yaml
 *     sha256: d31d6e9748e251b868aeb421e39f452bfbb57932e9ba8e50fe2be5a6cf9b61a6
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
