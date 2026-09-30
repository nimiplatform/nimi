/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: 3b4cb2d13b487510235c11016deda952e56cbc019eae09c0e985b6b711e7e0d9
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 57a4250a06199ac2b0185ebc7afa578a39e3dad0f896eb08f41d8aa47067c407
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
