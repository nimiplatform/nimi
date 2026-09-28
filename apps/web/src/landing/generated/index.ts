/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: cab0afbe0696c2247f8e68f62c1e5e5f3b621f5334f395dcdf81c31a0dae6b68
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 288e33ee2771e5961f13bad10fb36dc49a3795322afb3fcdead1aefc90e1da67
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
