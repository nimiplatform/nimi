/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: ae802b6d8446fcaad2a20695434360f111824317538d29e5f72c2b441aa86f7f
 *   config/runtime-provider-capabilities.yaml
 *     sha256: d5330844a7afb051c41a1e40fc348ccb2749192a9a24f8d9f233d29c9007bbe7
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
