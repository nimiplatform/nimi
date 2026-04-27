import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  validateAgentCenterLocalConfig,
  validateAgentCenterAvatarPackageImportResult,
  validateAgentCenterAvatarPackageValidationResult,
  validateAgentCenterBackgroundAssetResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterBackgroundValidationResult,
  validateAgentCenterLocalResourceRemoveResult,
  type AgentCenterAvatarPackageKind,
  type AgentCenterAvatarPackageImportResult,
  type AgentCenterAvatarPackageValidationResult,
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

function parseAgentCenterAvatarPackageValidationResult(value: unknown): AgentCenterAvatarPackageValidationResult {
  const result = validateAgentCenterAvatarPackageValidationResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center avatar package validation payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterAvatarPackageImportResult(value: unknown): AgentCenterAvatarPackageImportResult {
  const result = validateAgentCenterAvatarPackageImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center avatar package import payload is invalid: ${result.errors.join('; ')}`);
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

export function agentCenterLocalConfigQueryKey(accountId: string, agentId: string) {
  return ['agent-center-local-config', accountId, agentId] as const;
}

export async function getAgentCenterLocalConfig(input: {
  accountId: string;
  agentId: string;
}): Promise<AgentCenterLocalConfig> {
  requireTauri('desktop_agent_center_config_get');
  return invokeChecked('desktop_agent_center_config_get', {
    payload: input,
  }, parseAgentCenterLocalConfig);
}

export async function putAgentCenterLocalConfig(input: {
  accountId: string;
  agentId: string;
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

export async function pickAgentCenterAvatarPackageSource(input: {
  kind: AgentCenterAvatarPackageKind;
}): Promise<string | null> {
  requireTauri('desktop_agent_center_avatar_package_pick_source');
  return invokeChecked('desktop_agent_center_avatar_package_pick_source', {
    payload: input,
  }, parseOptionalPath);
}

export async function pickAgentCenterBackgroundSource(): Promise<string | null> {
  requireTauri('desktop_agent_center_background_pick_source');
  return invokeChecked('desktop_agent_center_background_pick_source', {}, parseOptionalPath);
}

export async function importAgentCenterAvatarPackage(input: {
  accountId: string;
  agentId: string;
  kind: AgentCenterAvatarPackageKind;
  sourcePath: string;
  displayName?: string;
  select?: boolean;
}): Promise<AgentCenterAvatarPackageImportResult> {
  requireTauri('desktop_agent_center_avatar_package_import');
  return invokeChecked('desktop_agent_center_avatar_package_import', {
    payload: input,
  }, parseAgentCenterAvatarPackageImportResult);
}

export async function removeAgentCenterAvatarPackage(input: {
  accountId: string;
  agentId: string;
  kind: AgentCenterAvatarPackageKind;
  packageId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_avatar_package_remove');
  return invokeChecked('desktop_agent_center_avatar_package_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function importAgentCenterBackground(input: {
  accountId: string;
  agentId: string;
  sourcePath: string;
  displayName?: string;
  select?: boolean;
}): Promise<AgentCenterBackgroundImportResult> {
  requireTauri('desktop_agent_center_background_import');
  return invokeChecked('desktop_agent_center_background_import', {
    payload: input,
  }, parseAgentCenterBackgroundImportResult);
}

export async function removeAgentCenterBackground(input: {
  accountId: string;
  agentId: string;
  backgroundAssetId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
  requireTauri('desktop_agent_center_background_remove');
  return invokeChecked('desktop_agent_center_background_remove', {
    payload: input,
  }, parseAgentCenterLocalResourceRemoveResult);
}

export async function removeAgentCenterAgentLocalResources(input: {
  accountId: string;
  agentId: string;
}): Promise<AgentCenterLocalResourceRemoveResult> {
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

export async function validateAgentCenterAvatarPackage(input: {
  accountId: string;
  agentId: string;
  kind: AgentCenterAvatarPackageKind;
  packageId: string;
}): Promise<AgentCenterAvatarPackageValidationResult> {
  requireTauri('desktop_agent_center_avatar_package_validate');
  return invokeChecked('desktop_agent_center_avatar_package_validate', {
    payload: input,
  }, parseAgentCenterAvatarPackageValidationResult);
}

export async function validateAgentCenterBackground(input: {
  accountId: string;
  agentId: string;
  backgroundAssetId: string;
}): Promise<AgentCenterBackgroundValidationResult> {
  requireTauri('desktop_agent_center_background_validate');
  return invokeChecked('desktop_agent_center_background_validate', {
    payload: input,
  }, parseAgentCenterBackgroundValidationResult);
}

export async function getAgentCenterBackgroundAsset(input: {
  accountId: string;
  agentId: string;
  backgroundAssetId: string;
}): Promise<AgentCenterBackgroundAssetResult> {
  requireTauri('desktop_agent_center_background_asset_get');
  return invokeChecked('desktop_agent_center_background_asset_get', {
    payload: input,
  }, parseAgentCenterBackgroundAssetResult);
}
