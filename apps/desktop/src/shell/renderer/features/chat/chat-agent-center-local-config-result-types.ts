export type AgentCenterAvatarAssetKind = 'live2d' | 'vrm';

export type AgentCenterValidationIssueSeverity = 'error' | 'warning';

export type AgentCenterValidationIssue = {
  code: string;
  message: string;
  path: string | null;
  severity: AgentCenterValidationIssueSeverity;
};

export type AgentCenterLive2dAdapterManifestImportResult = {
  manifest_ref: string;
  local_asset_id: string;
  selected: boolean;
  sha256: string;
  bytes: number;
  imported_at: string;
};

export type AgentCenterLive2dAdapterManifestImportParseResult =
  | { ok: true; result: AgentCenterLive2dAdapterManifestImportResult }
  | { ok: false; errors: string[] };

export type AgentCenterAvatarAssetImportResult = {
  local_asset_id: string;
  backend_kind: AgentCenterAvatarAssetKind;
  backend_capability_profile_ref: string;
  selected: boolean;
  manifest_sha256: string;
  asset_bytes: number;
  file_count: number;
  imported_at: string;
};

export type AgentCenterAvatarAssetImportParseResult =
  | { ok: true; result: AgentCenterAvatarAssetImportResult }
  | { ok: false; errors: string[] };

export type AgentCenterAvatarAssetRecord = {
  local_asset_id: string;
  backend_kind: AgentCenterAvatarAssetKind;
  display_name: string;
  source_label: string;
  backend_capability_profile_ref: string;
  asset_bytes: number;
  file_count: number;
  imported_at: string;
  selected: boolean;
  validation: AgentCenterAvatarAssetValidationResult;
};

export type AgentCenterAvatarAssetListResult = {
  selected_local_asset_id: string | null;
  assets: AgentCenterAvatarAssetRecord[];
};

export type AgentCenterAvatarAssetListParseResult =
  | { ok: true; result: AgentCenterAvatarAssetListResult }
  | { ok: false; errors: string[] };

export type AgentCenterAvatarAssetValidationStatus =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_entry'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_backend'
  | 'asset_missing'
  | 'digest_mismatch'
  | 'selection_missing';

export type AgentCenterAvatarAssetValidationResult = {
  schema_version: 1;
  local_asset_id: string | null;
  backend_kind: AgentCenterAvatarAssetKind | null;
  backend_capability_profile_ref: string | null;
  checked_at: string;
  status: AgentCenterAvatarAssetValidationStatus;
  errors: AgentCenterValidationIssue[];
  warnings: AgentCenterValidationIssue[];
};

export type AgentCenterAvatarAssetValidationParseResult =
  | { ok: true; result: AgentCenterAvatarAssetValidationResult }
  | { ok: false; errors: string[] };

export type AgentCenterLocalResourceRemoveResult = {
  resource_kind: 'avatar_asset' | 'background' | 'agent_local_resources' | 'account_local_resources';
  resource_id: string;
  quarantined: boolean;
  operation_id: string;
  status: 'completed';
};

export type AgentCenterLocalResourceRemoveParseResult =
  | { ok: true; result: AgentCenterLocalResourceRemoveResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundValidationStatus =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_image'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_mime'
  | 'asset_missing'
  | 'digest_mismatch';

export type AgentCenterBackgroundValidationResult = {
  schema_version: 1;
  background_asset_id: string;
  checked_at: string;
  status: AgentCenterBackgroundValidationStatus;
  errors: AgentCenterValidationIssue[];
  warnings: AgentCenterValidationIssue[];
};

export type AgentCenterBackgroundValidationParseResult =
  | { ok: true; result: AgentCenterBackgroundValidationResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundImportResult = {
  background_asset_id: string;
  selected: boolean;
  validation: AgentCenterBackgroundValidationResult;
};

export type AgentCenterBackgroundImportParseResult =
  | { ok: true; result: AgentCenterBackgroundImportResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundAssetResult = {
  background_asset_id: string;
  file_url: string;
  validation: AgentCenterBackgroundValidationResult;
};

export type AgentCenterBackgroundAssetParseResult =
  | { ok: true; result: AgentCenterBackgroundAssetResult }
  | { ok: false; errors: string[] };
