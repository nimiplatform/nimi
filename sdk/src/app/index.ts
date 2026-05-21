export { NimiAppClient, NimiAppClientError } from './client.js';
export {
  NimiAppRegistryTransportError,
  createNimiAppRegistryTransport,
} from './registry-transport.js';
export type { NimiAppTransport } from './transport.js';
export type {
  AppKind,
  AppLaunchReadiness,
  NimiAppInstallEvidenceRow,
  NimiAppInstallVerificationState,
  NimiAppOrdinaryVisibility,
  NimiAppReleaseDescriptorClass,
  NimiAppReleaseDescriptorRow,
  NimiAppReleaseSourceKind,
  NimiAppRow,
  NimiAppStatus,
  NimiAppStorageRoots,
  TrustTierId,
} from './types.js';
export type {
  NimiAppAdmissionStatus,
  NimiAppRegistrySourceRow,
  NimiAppRegistryTransportOptions,
} from './registry-transport.js';
export {
  CANONICAL_APP_KINDS,
  CANONICAL_LAUNCH_READINESS,
  CANONICAL_ORDINARY_VISIBILITY,
  CANONICAL_TRUST_TIERS,
  isCanonicalAppKind,
  isCanonicalLaunchReadiness,
  isCanonicalOrdinaryVisibility,
  isCanonicalTrustTier,
} from './types.js';
