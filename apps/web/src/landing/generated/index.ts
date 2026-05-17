/**
 * @generated
 * Sources:
 *   .nimi/spec/runtime/kernel/tables/provider-catalog.yaml
 *     sha256: 05df9fa4f477afc9ac2cee30981548f4482f9eab8ecdb8d9b800121e73114382
 *   .nimi/spec/runtime/kernel/tables/provider-capabilities.yaml
 *     sha256: 1fde68e8e915cbe83b1fd6c473f337c7c8baa3b382a94cef6605056c5be0b9d3
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
