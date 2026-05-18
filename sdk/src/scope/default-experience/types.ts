// SDK Default Experience Profile types.
//
// Mirrors `.nimi/spec/platform/kernel/default-experience-profile-contract.md`
// (P-DXP-001..P-DXP-012) and the typed Runtime adapter contract that
// Wave 1's Desktop bridge consumes.

export type PrivacyPosture = 'cloud-ok' | 'local-preferred' | 'local-required';

export type ComputePosture = 'cpu-only' | 'metal-capable' | 'cuda-capable' | 'cloud-only';

export type RoutingPolicy = 'cloud-first' | 'local-first' | 'hybrid-explicit';

export type ApplicableScope = 'first-run' | 'first-party-app' | 'scope-bound-apply';

export type ColdStartState =
  | 'unavailable'
  | 'setup-required'
  | 'needs-confirmation'
  | 'in-progress'
  | 'failed'
  | 'unsupported'
  | 'stale-projection'
  | 'ready';

export interface HostProfile {
  readonly profileId: string;
  readonly platform: { readonly os: string; readonly arch: string };
  readonly acceleratorVendor?: string;
  readonly acceleratorPlanes?: readonly string[];
}

export interface DefaultExperienceProfile {
  readonly alias: string;
  readonly privacyPosture: PrivacyPosture;
  readonly computePosture: ComputePosture;
  readonly capabilitySet: readonly string[];
  readonly routingPolicy: RoutingPolicy;
  readonly hostCapabilityProfileRefs: readonly string[];
  readonly applicableScopes: readonly ApplicableScope[];
  readonly materializationConfirmationRequired: boolean;
  readonly sourceRule: string;
}

export interface ProfilePreferences {
  readonly preferredPrivacy?: PrivacyPosture;
  readonly preferredCompute?: ComputePosture;
  readonly preferredRouting?: RoutingPolicy;
}

export interface UpstreamInputs {
  readonly runtimeDaemon: ColdStartState;
  readonly account: ColdStartState;
  readonly defaultExperienceProfile: ColdStartState;
  readonly materialization: ColdStartState;
  readonly appRegistry: ColdStartState;
  readonly cognitionMemory: ColdStartState;
}

export interface ColdStartProjection {
  readonly state: ColdStartState;
  readonly reasonOwner?: string;
  readonly detail?: string;
}

export interface ScopeRef {
  readonly kind: 'account' | 'workspace' | 'first-run' | 'app';
  readonly id: string;
}

export interface ApplyResult {
  readonly applied: boolean;
  readonly profileId: string;
  readonly scope: ScopeRef;
}

export const CANONICAL_PRIVACY_POSTURES: readonly PrivacyPosture[] = [
  'cloud-ok',
  'local-preferred',
  'local-required',
];

export const CANONICAL_COMPUTE_POSTURES: readonly ComputePosture[] = [
  'cpu-only',
  'metal-capable',
  'cuda-capable',
  'cloud-only',
];

export const CANONICAL_ROUTING_POLICIES: readonly RoutingPolicy[] = [
  'cloud-first',
  'local-first',
  'hybrid-explicit',
];

export const CANONICAL_APPLICABLE_SCOPES: readonly ApplicableScope[] = [
  'first-run',
  'first-party-app',
  'scope-bound-apply',
];

export const CANONICAL_COLD_START_STATES: readonly ColdStartState[] = [
  'unavailable',
  'setup-required',
  'needs-confirmation',
  'in-progress',
  'failed',
  'unsupported',
  'stale-projection',
  'ready',
];

export function isCanonicalPrivacyPosture(value: unknown): value is PrivacyPosture {
  return typeof value === 'string' && CANONICAL_PRIVACY_POSTURES.includes(value as PrivacyPosture);
}

export function isCanonicalComputePosture(value: unknown): value is ComputePosture {
  return typeof value === 'string' && CANONICAL_COMPUTE_POSTURES.includes(value as ComputePosture);
}

export function isCanonicalRoutingPolicy(value: unknown): value is RoutingPolicy {
  return typeof value === 'string' && CANONICAL_ROUTING_POLICIES.includes(value as RoutingPolicy);
}

export function isCanonicalApplicableScope(value: unknown): value is ApplicableScope {
  return typeof value === 'string' && CANONICAL_APPLICABLE_SCOPES.includes(value as ApplicableScope);
}

export function isCanonicalColdStartState(value: unknown): value is ColdStartState {
  return typeof value === 'string' && CANONICAL_COLD_START_STATES.includes(value as ColdStartState);
}
