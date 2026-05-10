/**
 * @generated
 * Sources:
 *   .nimi/spec/runtime/kernel/tables/provider-catalog.yaml
 *     sha256: ea95fe6bf6b8b6961a6b8ac708d6396dfc4f8618ed7d755de920319b2c6db9d3
 *   .nimi/spec/runtime/kernel/tables/provider-capabilities.yaml
 *     sha256: 58bdbb586636a7af47a6d823ed0337188ef267c4cbe26a015a84d12748755db1
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
