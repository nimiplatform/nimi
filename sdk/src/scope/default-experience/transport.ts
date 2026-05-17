// DefaultExperienceTransport is the abstract transport surface that the
// SDK client consumes. The host (Desktop, web shell, install gateway,
// etc.) provides a concrete implementation backed by gRPC, Tauri
// commands, or HTTP. The SDK itself never holds a transport or makes
// direct network calls.

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

export interface DefaultExperienceTransport {
  hostProfile(): Promise<HostProfile>;
  recommendProfile(
    scope: ApplicableScope,
    preferences?: ProfilePreferences,
  ): Promise<DefaultExperienceProfile>;
  applyProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult>;
  projectColdStart(inputs: UpstreamInputs): Promise<ColdStartProjection>;
}
