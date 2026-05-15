use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterConfigScopePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterConfigPutPayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub config: AgentCenterLocalConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterLive2dAdapterManifestImportPayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub package_id: String,
    pub source_path: String,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackageImportPayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub kind: AgentCenterAvatarBackendKind,
    pub source_path: String,
    pub display_name: Option<String>,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackageRemovePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub package_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAgentLocalResourcesRemovePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAccountLocalResourcesRemovePayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterLive2dAdapterManifestImportResult {
    pub manifest_ref: String,
    pub package_id: String,
    pub selected: bool,
    pub sha256: String,
    pub bytes: u64,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterAvatarPackageImportResult {
    pub package_id: String,
    pub backend_kind: AgentCenterAvatarBackendKind,
    pub backend_capability_profile_ref: String,
    pub selected: bool,
    pub manifest_sha256: String,
    pub package_bytes: u64,
    pub file_count: usize,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterLocalResourceRemoveResult {
    pub resource_kind: String,
    pub resource_id: String,
    pub quarantined: bool,
    pub operation_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterBackgroundValidatePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub background_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterBackgroundRemovePayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub background_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterBackgroundImportPayload {
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub source_path: String,
    pub display_name: Option<String>,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterBackgroundImportResult {
    pub background_asset_id: String,
    pub selected: bool,
    pub validation: AgentCenterBackgroundValidationResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterBackgroundAssetResult {
    pub background_asset_id: String,
    pub file_url: String,
    pub validation: AgentCenterBackgroundValidationResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarBackendKind {
    Live2d,
    Vrm,
    Future,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarConversationAnchorScope {
    CurrentAnchor,
    ExplicitDebugAnchor,
    NoAnchor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarInstancePolicy {
    ReuseActiveInstance,
    LaunchNewInstance,
    RequireUserSelection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterGeneratedMotionProviderPolicy {
    RequireProfileSupport,
    DisableGeneratedMotion,
    DebugOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarLaunchMode {
    Manual,
    DebugSession,
    StartWithChat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarDebugProfile {
    Standard,
    StrictBackendEvidence,
    RouteMatrix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarConfigProvenanceSource {
    UserSelection,
    ImportValidation,
    RuntimeProjection,
    AvatarBackendEvidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterLive2dAdapterManifestSource {
    None,
    EmbeddedCreatorManifest,
    ExternalSidecarManifest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterMotionPreference {
    System,
    Reduced,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterSectionId {
    Overview,
    Appearance,
    ChatBehavior,
    Model,
    Cognition,
    Advanced,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterAvatarConfigProvenance {
    pub source: AgentCenterAvatarConfigProvenanceSource,
    pub evidence_ref: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterAppearanceModule {
    pub schema_version: u8,
    pub background_asset_id: Option<String>,
    pub motion: AgentCenterMotionPreference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterAvatarPackageModule {
    pub schema_version: u8,
    pub conversation_anchor_scope: AgentCenterAvatarConversationAnchorScope,
    pub avatar_package_ref: Option<String>,
    pub live2d_adapter_manifest_source: AgentCenterLive2dAdapterManifestSource,
    pub live2d_adapter_manifest_ref: Option<String>,
    pub avatar_instance_policy: AgentCenterAvatarInstancePolicy,
    pub backend_kind: AgentCenterAvatarBackendKind,
    pub backend_capability_profile_ref: Option<String>,
    pub generated_motion_provider_policy: AgentCenterGeneratedMotionProviderPolicy,
    pub launch_mode: AgentCenterAvatarLaunchMode,
    pub debug_profile: AgentCenterAvatarDebugProfile,
    pub updated_at: String,
    pub provenance: AgentCenterAvatarConfigProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterLocalHistoryModule {
    pub schema_version: u8,
    pub last_cleared_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterUiModule {
    pub schema_version: u8,
    pub last_section: AgentCenterSectionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterLocalConfigModules {
    pub appearance: AgentCenterAppearanceModule,
    pub avatar_package: AgentCenterAvatarPackageModule,
    pub local_history: AgentCenterLocalHistoryModule,
    pub ui: AgentCenterUiModule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterLocalConfig {
    pub schema_version: u8,
    pub config_kind: String,
    pub account_id: String,
    pub owner_user_id: String,
    pub realm_agent_id: String,
    pub local_agent_ref: String,
    pub modules: AgentCenterLocalConfigModules,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterValidationIssueSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterValidationIssue {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
    pub severity: AgentCenterValidationIssueSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterBackgroundValidationStatus {
    Valid,
    InvalidManifest,
    MissingImage,
    PermissionDenied,
    PathRejected,
    UnsupportedMime,
    AssetMissing,
    DigestMismatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterBackgroundValidationResult {
    pub schema_version: u8,
    pub background_asset_id: String,
    pub checked_at: String,
    pub status: AgentCenterBackgroundValidationStatus,
    pub errors: Vec<AgentCenterValidationIssue>,
    pub warnings: Vec<AgentCenterValidationIssue>,
}
