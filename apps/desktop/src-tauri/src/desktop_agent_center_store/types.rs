use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterConfigScopePayload {
    pub account_id: String,
    pub agent_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterConfigPutPayload {
    pub account_id: String,
    pub agent_id: String,
    pub config: AgentCenterLocalConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackageValidatePayload {
    pub account_id: String,
    pub agent_id: String,
    pub kind: AgentCenterAvatarPackageKind,
    pub package_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackagePickSourcePayload {
    pub kind: AgentCenterAvatarPackageKind,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackageImportPayload {
    pub account_id: String,
    pub agent_id: String,
    pub kind: AgentCenterAvatarPackageKind,
    pub source_path: String,
    pub display_name: Option<String>,
    pub select: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAvatarPackageRemovePayload {
    pub account_id: String,
    pub agent_id: String,
    pub kind: AgentCenterAvatarPackageKind,
    pub package_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAgentLocalResourcesRemovePayload {
    pub account_id: String,
    pub agent_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterAccountLocalResourcesRemovePayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopAgentCenterAvatarPackageImportResult {
    pub package_id: String,
    pub kind: AgentCenterAvatarPackageKind,
    pub selected: bool,
    pub validation: AgentCenterAvatarPackageValidationResult,
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
    pub agent_id: String,
    pub background_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterBackgroundRemovePayload {
    pub account_id: String,
    pub agent_id: String,
    pub background_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAgentCenterBackgroundImportPayload {
    pub account_id: String,
    pub agent_id: String,
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
pub(crate) enum AgentCenterAvatarPackageKind {
    Live2d,
    Vrm,
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
pub(crate) struct AgentCenterSelectedAvatarPackage {
    pub kind: AgentCenterAvatarPackageKind,
    pub package_id: String,
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
    pub selected_package: Option<AgentCenterSelectedAvatarPackage>,
    pub conversation_anchor_scope: AgentCenterAvatarConversationAnchorScope,
    pub avatar_package_ref: Option<String>,
    pub avatar_instance_policy: AgentCenterAvatarInstancePolicy,
    pub backend_kind: AgentCenterAvatarBackendKind,
    pub backend_capability_profile_ref: Option<String>,
    pub generated_motion_provider_policy: AgentCenterGeneratedMotionProviderPolicy,
    pub launch_mode: AgentCenterAvatarLaunchMode,
    pub debug_profile: AgentCenterAvatarDebugProfile,
    pub updated_at: String,
    pub provenance: AgentCenterAvatarConfigProvenance,
    pub last_validated_at: Option<String>,
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
    pub agent_id: String,
    pub modules: AgentCenterLocalConfigModules,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentCenterAvatarPackageValidationStatus {
    Valid,
    InvalidManifest,
    MissingFiles,
    PermissionDenied,
    PathRejected,
    UnsupportedKind,
    PackageMissing,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentCenterAvatarPackageValidationResult {
    pub schema_version: u8,
    pub package_id: String,
    pub checked_at: String,
    pub status: AgentCenterAvatarPackageValidationStatus,
    pub errors: Vec<AgentCenterValidationIssue>,
    pub warnings: Vec<AgentCenterValidationIssue>,
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
