// SDK Nimi App client types.
//
// Mirrors `.nimi/spec/platform/kernel/nimi-app-admission-contract.md`
// (P-NAPP-001..P-NAPP-012), `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`,
// and `.nimi/spec/sdk/kernel/nimi-app-client-contract.md`.

export type TrustTierId = 'nimi-first-party' | 'nimi-verified-partner' | 'nimi-community';

export const CANONICAL_TRUST_TIERS: readonly TrustTierId[] = [
  'nimi-first-party',
  'nimi-verified-partner',
  'nimi-community',
];

export function isCanonicalTrustTier(value: unknown): value is TrustTierId {
  return typeof value === 'string' && CANONICAL_TRUST_TIERS.includes(value as TrustTierId);
}

// AppLifecyclePhase enumerates admitted phases. Retired extension kinds are
// explicitly NOT included per P-NAPP-012 and P-MOEX-006.
export type AppKind = 'nimi-app';

export const CANONICAL_APP_KINDS: readonly AppKind[] = ['nimi-app'];

export function isCanonicalAppKind(value: unknown): value is AppKind {
  return typeof value === 'string' && CANONICAL_APP_KINDS.includes(value as AppKind);
}

export type NimiAppOrdinaryVisibility =
  | 'ordinary-visible'
  | 'hidden-internal'
  | 'developer-only'
  | 'not-admitted-visible';

export const CANONICAL_ORDINARY_VISIBILITY: readonly NimiAppOrdinaryVisibility[] = [
  'ordinary-visible',
  'hidden-internal',
  'developer-only',
  'not-admitted-visible',
];

export function isCanonicalOrdinaryVisibility(value: unknown): value is NimiAppOrdinaryVisibility {
  return typeof value === 'string' && CANONICAL_ORDINARY_VISIBILITY.includes(value as NimiAppOrdinaryVisibility);
}

// AppLaunchReadiness enumerates the admitted launch readiness states.
// `blocked_by_master_gate` is the explicit gated state required by
// Avatar master gate coordination (see avatar-master-gate-coordination.md).
export type AppLaunchReadiness =
  | 'ready'
  | 'install-required'
  | 'update-required'
  | 'repair-required'
  | 'permission-required'
  | 'blocked-by-master-gate'
  | 'unsupported';

export const CANONICAL_LAUNCH_READINESS: readonly AppLaunchReadiness[] = [
  'ready',
  'install-required',
  'update-required',
  'repair-required',
  'permission-required',
  'blocked-by-master-gate',
  'unsupported',
];

export function isCanonicalLaunchReadiness(value: unknown): value is AppLaunchReadiness {
  return typeof value === 'string' && CANONICAL_LAUNCH_READINESS.includes(value as AppLaunchReadiness);
}

export interface NimiAppRow {
  readonly appId: string;
  readonly appKind: AppKind;
  readonly displayName: string;
  readonly trustTier: TrustTierId;
  readonly publisher: string;
  readonly releaseDescriptorRef: string;
  readonly installStoragePolicyRef: string;
  readonly sourceRule: string;
}

export interface NimiAppStatus {
  readonly appId: string;
  readonly launchReadiness: AppLaunchReadiness;
  readonly releaseDescriptorRef?: string;
  readonly installStoragePolicyRef?: string;
  readonly storageRoots?: NimiAppStorageRoots;
  readonly verificationState?: NimiAppInstallVerificationState;
  readonly installedVersion?: string;
  readonly availableVersion?: string;
  readonly detail?: string;
}

export type NimiAppReleaseDescriptorClass =
  | 'bundled-with-nimi'
  | 'external-immutable-artifact';

export type NimiAppReleaseSourceKind =
  | 'nimi-bundle'
  | 'github-release'
  | 'github-commit'
  | 'npm-package';

export interface NimiAppReleaseDescriptorRow {
  readonly descriptorId: string;
  readonly appId: string;
  readonly version: string;
  readonly descriptorClass: NimiAppReleaseDescriptorClass;
  readonly sourceKind: NimiAppReleaseSourceKind;
  readonly sourceRef: string;
  readonly artifactLocator: string;
  readonly digestAlgorithm: 'sha256';
  readonly sha256: string;
  readonly size: string;
  readonly provenanceRef: string;
  readonly packageKind: AppKind;
  readonly entryRef: string;
  readonly sandboxRef: string;
  readonly permissionsRef: string;
  readonly storagePolicyRef: string;
  readonly admissionPath: string;
  readonly mutableSourceAllowed: boolean;
  readonly installDigestVerificationRequired: string;
  readonly sourceRule: string;
}

export type NimiAppInstallVerificationState =
  | 'not-installed'
  | 'digest-verified'
  | 'digest-mismatch'
  | 'blocked'
  | 'unsupported';

export interface NimiAppInstallEvidenceRow {
  readonly appId: string;
  readonly releaseDescriptorRef: string;
  readonly storagePolicyRef: string;
  readonly installedVersion?: string;
  readonly sha256?: string;
  readonly verificationState: NimiAppInstallVerificationState;
  readonly storageRoots?: NimiAppStorageRoots;
  readonly detail?: string;
}

export interface NimiAppStorageRoots {
  readonly releaseRoot: string;
  readonly dataRoot: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
}

// T4 Fork B: the Nimi App lifecycle mutation surface (operation result /
// launch scope ref / health-repair action / lifecycle event / subscription)
// is retired from `@nimiplatform/sdk/app`. NimiAppClient is read-projection
// only; all lifecycle mutation — install / update / uninstall / open /
// healthRepair plus lifecycle-event streaming — is the runtime-mediated
// `runtime.appLifecycle` surface (`@nimiplatform/sdk/runtime`).
