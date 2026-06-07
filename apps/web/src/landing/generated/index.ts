/**
 * @generated
 * Sources:
 *   .nimi/spec/runtime/kernel/tables/provider-catalog.yaml
 *     sha256: 6b88f478de96e1a40e07b7d3e1b2c3b81febd3f111b6ce3cf5a3180fc5c71e4c
 *   .nimi/spec/runtime/kernel/tables/provider-capabilities.yaml
 *     sha256: 35b551438417aaa00b46862be04bcdc869abef0a1a6c3487342526f9fb7e78c3
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
