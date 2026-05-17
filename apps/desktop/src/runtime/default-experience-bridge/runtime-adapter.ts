// RuntimeAdapter is the typed seam to the Runtime public surface. The
// Desktop config bridge consumes only this interface; the concrete
// implementation is supplied by SDK via a follow-on Wave 1 packet that
// wires `@nimiplatform/sdk/runtime` to the gRPC method.
//
// Desktop must NEVER call `runtime/internal/**` directly (separate
// process / language boundary) and must NEVER hold an HTTP client of
// its own; all Runtime access flows through this typed adapter.

import type {
  ApplyResult,
  ColdStartProjection,
  DefaultExperienceProfile,
  HostProfile,
  ProfilePreferences,
  ScopeRef,
  UpstreamInputs,
  ApplicableScope,
} from './types.js';

export interface RuntimeAdapter {
  hostProfile(): Promise<HostProfile>;
  recommendProfile(
    scope: ApplicableScope,
    preferences?: ProfilePreferences,
  ): Promise<DefaultExperienceProfile>;
  applyProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult>;
  projectColdStart(inputs: UpstreamInputs): Promise<ColdStartProjection>;
}
