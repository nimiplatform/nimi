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

// AppLifecyclePhase enumerates admitted phases. Public Mod and Extension
// kinds are explicitly NOT included per P-NAPP-012 and P-MOEX-006.
export type AppKind = 'nimi-app';

export const CANONICAL_APP_KINDS: readonly AppKind[] = ['nimi-app'];

export function isCanonicalAppKind(value: unknown): value is AppKind {
  return typeof value === 'string' && CANONICAL_APP_KINDS.includes(value as AppKind);
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
  readonly sourceRule: string;
}

export interface NimiAppStatus {
  readonly appId: string;
  readonly launchReadiness: AppLaunchReadiness;
  readonly installedVersion?: string;
  readonly availableVersion?: string;
  readonly detail?: string;
}
