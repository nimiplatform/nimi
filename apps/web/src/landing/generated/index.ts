/**
 * @generated
 * Sources:
 *   config/runtime-provider-catalog.yaml
 *     sha256: bdd4523fb39742ad63a2ef5f5d15041c855d11b5b263b9b70ab40e5ba14d3a6c
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
