/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: 075f5f7cdba11e1e0f48623b6c6f72655b3c05afad7fbdf59fa90a2bc0be5c7d
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 2254ba94853687242e3f89754095e82c22cd0fc538208a09e890d1c20b27172a
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
