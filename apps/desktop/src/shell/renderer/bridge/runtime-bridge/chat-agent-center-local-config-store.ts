import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  validateAgentCenterLocalConfig,
  validateAgentCenterAvatarAssetImportResult,
  validateAgentCenterAvatarAssetListResult,
  validateAgentCenterAvatarAssetValidationResult,
  validateAgentCenterLive2dAdapterManifestImportResult,
  validateAgentCenterBackgroundAssetResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterBackgroundValidationResult,
  validateAgentCenterLocalResourceRemoveResult,
  type AgentCenterAvatarAssetImportResult,
  type AgentCenterAvatarAssetListResult,
  type AgentCenterAvatarAssetKind,
  type AgentCenterAvatarAssetValidationResult,
  type AgentCenterLive2dAdapterManifestImportResult,
  type AgentCenterBackgroundAssetResult,
  type AgentCenterBackgroundImportResult,
  type AgentCenterBackgroundValidationResult,
  type AgentCenterLocalConfig,
  type AgentCenterLocalResourceRemoveResult,
} from '@renderer/features/chat/chat-agent-center-local-config';

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

function parseAgentCenterLocalConfig(value: unknown): AgentCenterLocalConfig {
  const result = validateAgentCenterLocalConfig(value);
  if (!result.ok) {
    throw new Error(`Agent Center local config payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.config;
}

function parseAgentCenterAvatarAssetImportResult(value: unknown): AgentCenterAvatarAssetImportResult {
  const result = validateAgentCenterAvatarAssetImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center avatar asset import payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterAvatarAssetListResult(value: unknown): AgentCenterAvatarAssetListResult {
  const result = validateAgentCenterAvatarAssetListResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center avatar asset list payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterAvatarAssetValidationResult(value: unknown): AgentCenterAvatarAssetValidationResult {
  const result = validateAgentCenterAvatarAssetValidationResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center avatar asset validation payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterLive2dAdapterManifestImportResult(value: unknown): AgentCenterLive2dAdapterManifestImportResult {
  const result = validateAgentCenterLive2dAdapterManifestImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center Live2D adapter manifest import payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterBackgroundValidationResult(value: unknown): AgentCenterBackgroundValidationResult {
  const result = validateAgentCenterBackgroundValidationResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center background validation payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterBackgroundImportResult(value: unknown): AgentCenterBackgroundImportResult {
  const result = validateAgentCenterBackgroundImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center background import payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterBackgroundAssetResult(value: unknown): AgentCenterBackgroundAssetResult {
  const result = validateAgentCenterBackgroundAssetResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center background asset payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterLocalResourceRemoveResult(value: unknown): AgentCenterLocalResourceRemoveResult {
  const result = validateAgentCenterLocalResourceRemoveResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center resource removal payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

export type AgentCenterLocalIdentityInput = {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
};

export function agentCenterLocalConfigQueryKey(accountId: string, localAgentRef: string) {
  return ['agent-center-local-config', accountId, localAgentRef] as const;
}

export async function getAgentCenterLocalConfig(input: AgentCenterLocalIdentityInput): Promise<AgentCenterLocalConfig> {
  requireTauri('desktop_agent_center_config_get');
  return invokeChecked('desktop_agent_center_config_get', {
    payload: input,
  }, parseAgentCenterLocalConfig);
}

export async function putAgentCenterLocalConfig(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  config: AgentCenterLocalConfig;
}): Promise<AgentCenterLocalConfig> {
  requireTauri('desktop_agent_center_config_put');
  return invokeChecked('desktop_agent_center_config_put', {
    payload: input,
  }, parseAgentCenterLocalConfig);
}

function parseOptionalPath(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Agent Center file picker returned invalid payload');
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function pickAgentCenterLive2dAdapterManifestSource(): Promise<string | null> {
  requireTauri('desktop_agent_center_live2d_adapter_manifest_pick_source');
  return invokeChecked('desktop_agent_center_live2d_adapter_manifest_pick_source', {}, parseOptionalPath);
}

export async function pickAgentCenterAvatarAssetSource(kind: AgentCenterAvatarAssetKind): Promise<string | null> {
  const command = kind === 'live2d'
    ? 'desktop_agent_center_avatar_asset_pick_live2d_source'
    : 'desktop_agent_center_avatar_asset_pick_vrm_source';
  requireTauri(command);
  return invokeChecked(command, {}, parseOptionalPath);
}

export async function pickAgentCenterBackgroundSource(): Promise<string | null> {
  requireTauri('desktop_agent_center_background_pick_source');
  return invokeChecked('desktop_agent_center_background_pick_source', {}, parseOptionalPath);
}

export async function importAgentCenterAvatarAsset(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  kind: AgentCenterAvatarAssetKind;
  sourcePath: string;
  displayName?: string;
  select?: boolean;
}): Promise<AgentCenterAvatarAssetImportResult> {
  requireTauri('desktop_agent_center_avatar_asset_import');
  return invokeChecked('desktop_agent_center_avatar_asset_import', {
    payload: input,
  }, parseAgentCenterAvatarAssetImportResult);
}

export async function listAgentCenterAvatarAssets(
  input: AgentCenterLocalIdentityInput,
): Promise<AgentCenterAvatarAssetListResult> {
  requireTauri('desktop_agent_center_avatar_asset_list');
  return invokeChecked('desktop_agent_center_avatar_asset_list', {
    payload: input,
  }, parseAgentCenterAvatarAssetListResult);
}

export async function selectAgentCenterAvatarAsset(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  localAssetId: string;
}): Promise<AgentCenterLocalConfig> {
  requireTauri('desktop_agent_center_avatar_asset_select');
  return invokeChecked('desktop_agent_center_avatar_asset_select', {
    payload: input,
  }, parseAgentCenterLocalConfig);
}

export async function importAgentCenterLive2dAdapterManifest(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  localAssetId: string;
  sourcePath: string;
  select?: boolean;
}): Promise<AgentCenterLive2dAdapterManifestImportResult> {
  requireTauri('desktop_agent_center_live2d_adapter_manifest_import');
  return invokeChecked('desktop_agent_center_live2d_adapter_manifest_import', {
    payload: input,
  }, parseAgentCenterLive2dAdapterManifestImportResult);
}

export async function importAgentCenterBackground(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  sourcePath: string;
  displayName?: string;
  select?: boolean;
}): Promise<AgentCenterBackgroundImportResult> {
  requireTauri('desktop_agent_center_background_import');
  return invokeChecked('desktop_agent_center_background_import', {
    payload: input,
  }, parseAgentCenterBackgroundImportResult);
}

export async function removeAgentCenterAvatarAsset(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  localAssetId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_avatar_asset_remove');
  return invokeChecked('desktop_agent_center_avatar_asset_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function validateAgentCenterAvatarAsset(
  input: AgentCenterLocalIdentityInput,
): Promise<AgentCenterAvatarAssetValidationResult> {
  requireTauri('desktop_agent_center_avatar_asset_validate');
  return invokeChecked('desktop_agent_center_avatar_asset_validate', {
    payload: input,
  }, parseAgentCenterAvatarAssetValidationResult);
}

export async function removeAgentCenterBackground(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  backgroundAssetId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_background_remove');
  return invokeChecked('desktop_agent_center_background_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function removeAgentCenterAgentLocalResources(
  input: AgentCenterLocalIdentityInput,
): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_agent_local_resources_remove');
  return invokeChecked('desktop_agent_center_agent_local_resources_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function removeAgentCenterAccountLocalResources(input: {
  accountId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_account_local_resources_remove');
  return invokeChecked('desktop_agent_center_account_local_resources_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function validateAgentCenterBackground(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  backgroundAssetId: string;
}): Promise<AgentCenterBackgroundValidationResult> {
  requireTauri('desktop_agent_center_background_validate');
  return invokeChecked('desktop_agent_center_background_validate', {
    payload: input,
  }, parseAgentCenterBackgroundValidationResult);
}

export async function getAgentCenterBackgroundAsset(input: {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  backgroundAssetId: string;
}): Promise<AgentCenterBackgroundAssetResult> {
  requireTauri('desktop_agent_center_background_asset_get');
  return invokeChecked('desktop_agent_center_background_asset_get', {
    payload: input,
  }, parseAgentCenterBackgroundAssetResult);
}
