/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: a8eeb769a28f8b9b0fa9a141280dd81940363714467ede4f664bee88ebb937b8
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 9ed4cfa772d23f7364150844e5cc4988555cf4f6057952a2dc021ee0d03a1648
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
