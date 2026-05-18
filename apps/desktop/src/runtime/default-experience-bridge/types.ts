// Desktop Default Experience Bridge — typed contract surface.
//
// Mirrors .nimi/spec/platform/kernel/default-experience-profile-contract.md
// (P-DXP-001..P-DXP-012), .nimi/spec/runtime/kernel/device-profile-contract.md,
// and .nimi/spec/platform/kernel/cold-start-authority-contract.md (P-COLD-001).
//
// Per P-DXP-008, no provider/connector/engine/model identifier string
// constants appear in this module; all values come from typed catalog
// projections supplied by the RuntimeAdapter.

export type PrivacyPosture = 'cloud-ok' | 'local-preferred' | 'local-required';

export type ComputePosture = 'cpu-only' | 'metal-capable' | 'cuda-capable' | 'cloud-only';

export type RoutingPolicy = 'cloud-first' | 'local-first' | 'hybrid-explicit';

export type ApplicableScope = 'first-run' | 'first-party-app' | 'scope-bound-apply';

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

// ColdStartState mirrors the P-COLD-001 closed enum exactly. Bridge
// must never project anything outside this set.
export type ColdStartState =
  | 'unavailable'
  | 'setup-required'
  | 'needs-confirmation'
  | 'in-progress'
  | 'failed'
  | 'unsupported'
  | 'stale-projection'
  | 'ready';

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

// BridgeResult is the unified result type returned by the bridge's
// public methods. The status discriminator carries fail-closed
// semantics; callers must inspect status before assuming success.
export type BridgeResult<T> =
  | { readonly status: 'applied'; readonly value: T }
  | { readonly status: 'blocked'; readonly state: ColdStartState; readonly detail: string }
  | { readonly status: 'error'; readonly detail: string };
