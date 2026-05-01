import type { AgentCenterAvatarPackageKind, AgentCenterSelectedAvatarPackage } from './chat-agent-center-local-config';

export type AgentCenterAvatarBackendKind = AgentCenterAvatarPackageKind | 'future';
export type AgentCenterAvatarConversationAnchorScope = 'current_anchor' | 'explicit_debug_anchor' | 'no_anchor';
export type AgentCenterAvatarInstancePolicy = 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection';
export type AgentCenterGeneratedMotionProviderPolicy = 'require_profile_support' | 'disable_generated_motion' | 'debug_only';
export type AgentCenterAvatarLaunchMode = 'manual' | 'debug_session' | 'start_with_chat';
export type AgentCenterAvatarDebugProfile = 'standard' | 'strict_backend_evidence' | 'route_matrix';
export type AgentCenterAvatarConfigProvenanceSource =
  | 'user_selection'
  | 'import_validation'
  | 'runtime_projection'
  | 'avatar_backend_evidence';

export type AgentCenterAvatarConfigProvenance = {
  source: AgentCenterAvatarConfigProvenanceSource;
  evidence_ref: string;
};

export type AgentCenterAvatarPackageModule = {
  schema_version: 1;
  selected_package: AgentCenterSelectedAvatarPackage | null;
  conversation_anchor_scope: AgentCenterAvatarConversationAnchorScope;
  avatar_package_ref: string | null;
  avatar_instance_policy: AgentCenterAvatarInstancePolicy;
  backend_kind: AgentCenterAvatarBackendKind;
  backend_capability_profile_ref: string | null;
  generated_motion_provider_policy: AgentCenterGeneratedMotionProviderPolicy;
  launch_mode: AgentCenterAvatarLaunchMode;
  debug_profile: AgentCenterAvatarDebugProfile;
  updated_at: string;
  provenance: AgentCenterAvatarConfigProvenance;
  last_validated_at: string | null;
};

export type AgentCenterAvatarConfigPatch = Partial<Pick<
  AgentCenterAvatarPackageModule,
  | 'avatar_instance_policy'
  | 'backend_kind'
  | 'generated_motion_provider_policy'
  | 'launch_mode'
  | 'debug_profile'
>>;

export const AVATAR_BACKEND_KIND_VALUES = ['live2d', 'vrm', 'future'] as const;
export const AVATAR_CONVERSATION_ANCHOR_SCOPE_VALUES = ['current_anchor', 'explicit_debug_anchor', 'no_anchor'] as const;
export const AVATAR_INSTANCE_POLICY_VALUES = ['reuse_active_instance', 'launch_new_instance', 'require_user_selection'] as const;
export const GENERATED_MOTION_PROVIDER_POLICY_VALUES = ['require_profile_support', 'disable_generated_motion', 'debug_only'] as const;
export const AVATAR_LAUNCH_MODE_VALUES = ['manual', 'debug_session', 'start_with_chat'] as const;
export const AVATAR_DEBUG_PROFILE_VALUES = ['standard', 'strict_backend_evidence', 'route_matrix'] as const;
export const AVATAR_CONFIG_PROVENANCE_SOURCE_VALUES = ['user_selection', 'import_validation', 'runtime_projection', 'avatar_backend_evidence'] as const;

export function createDefaultAgentCenterAvatarPackageModule(): AgentCenterAvatarPackageModule {
  return {
    schema_version: 1,
    selected_package: null,
    conversation_anchor_scope: 'current_anchor',
    avatar_package_ref: null,
    avatar_instance_policy: 'reuse_active_instance',
    backend_kind: 'live2d',
    backend_capability_profile_ref: null,
    generated_motion_provider_policy: 'require_profile_support',
    launch_mode: 'manual',
    debug_profile: 'standard',
    updated_at: new Date().toISOString(),
    provenance: {
      source: 'runtime_projection',
      evidence_ref: 'agent-center-avatar-config-default',
    },
    last_validated_at: null,
  };
}
