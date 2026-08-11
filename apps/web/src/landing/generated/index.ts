/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: a8eeb769a28f8b9b0fa9a141280dd81940363714467ede4f664bee88ebb937b8
 *   config/runtime-provider-capabilities.yaml
 *     sha256: 37f02c3dd572ea861ea1a502662f2743c6b8e752c4c571912578674856ba5485
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
