/**
 * @generated
 * Sources:
 *   .nimi/spec/runtime/kernel/tables/provider-catalog.yaml
 *     sha256: 7bf7e60462e2f30be43889c407392fc82e2d9f98a412835d8f99a4f075cf94af
 *   .nimi/spec/runtime/kernel/tables/provider-capabilities.yaml
 *     sha256: e5504c6d071e8d73ca76094b39f2fd1b2eeef78cd6c7467130919122ef90cfd3
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
