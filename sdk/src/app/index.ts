export { NimiAppClient, NimiAppClientError } from './client.js';
export {
  NimiAppRegistryTransportError,
  createNimiAppRegistryTransport,
} from './registry-transport.js';
export type { NimiAppTransport } from './transport.js';
export type {
  AppKind,
  AppLaunchReadiness,
  NimiAppHealthRepairAction,
  NimiAppInstallEvidenceRow,
  NimiAppInstallVerificationState,
  NimiAppLifecycleEvent,
  NimiAppLaunchScopeRef,
  NimiAppOperationResult,
  NimiAppOperationState,
  NimiAppOrdinaryVisibility,
  NimiAppReleaseDescriptorClass,
  NimiAppReleaseDescriptorRow,
  NimiAppReleaseSourceKind,
  NimiAppRow,
  NimiAppStatus,
  NimiAppStorageRoots,
  NimiAppSubscription,
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
