import {
  hasTauriInvoke,
  openShellFileDialog,
  type ShellFileDialogOpenPayload,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  validateAgentCenterLocalConfig,
  validateAgentCenterAvatarAssetImportResult,
  validateAgentCenterAvatarAssetValidationResult,
  validateAgentCenterLive2dAdapterManifestImportResult,
  validateAgentCenterBackgroundAssetResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterBackgroundValidationResult,
  validateAgentCenterLocalResourceRemoveResult,
  type AgentCenterAvatarAssetImportResult,
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

function parseAgentCenterLive2dAdapterManifestImportResult(value: unknown): AgentCenterLive2dAdapterManifestImportResult {
  const result = validateAgentCenterLive2dAdapterManifestImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center Live2D adapter manifest import payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterAvatarAssetValidationResult(value: unknown): AgentCenterAvatarAssetValidationResult {
  const result = validateAgentCenterAvatarAssetValidationResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center Avatar asset validation payload is invalid: ${result.errors.join('; ')}`);
  }
  return result.result;
}

function parseAgentCenterAvatarAssetImportResult(value: unknown): AgentCenterAvatarAssetImportResult {
  const result = validateAgentCenterAvatarAssetImportResult(value);
  if (!result.ok) {
    throw new Error(`Agent Center Avatar asset import payload is invalid: ${result.errors.join('; ')}`);
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
  runtimeSourceRef: string;
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
  runtimeSourceRef: string;
  localAgentRef: string;
  config: AgentCenterLocalConfig;
}): Promise<AgentCenterLocalConfig> {
  requireTauri('desktop_agent_center_config_put');
  return invokeChecked('desktop_agent_center_config_put', {
    payload: {
      ...input,
      config: {
        ...input.config,
        account_id: input.accountId,
        owner_user_id: input.ownerUserId,
        runtime_source_ref: input.runtimeSourceRef,
        local_agent_ref: input.localAgentRef,
      },
    },
  }, parseAgentCenterLocalConfig);
}

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const normalized = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return normalized ? normalized : null;
}

async function pickAgentCenterFileDialog(payload: ShellFileDialogOpenPayload): Promise<string | null> {
  return firstDialogPath(await openShellFileDialog(payload));
}

export async function pickAgentCenterLive2dAdapterManifestSource(): Promise<string | null> {
  return pickAgentCenterFileDialog({
    kind: 'file',
    title: 'Select Live2D adapter manifest',
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
}

export async function pickAgentCenterAvatarLive2dSource(): Promise<string | null> {
  return pickAgentCenterFileDialog({
    kind: 'directory',
    title: 'Select Live2D folder',
  });
}

export async function pickAgentCenterAvatarVrmSource(): Promise<string | null> {
  return pickAgentCenterFileDialog({
    kind: 'file',
    title: 'Select VRM file',
    filters: [
      { name: 'VRM', extensions: ['vrm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
}

export async function pickAgentCenterBackgroundSource(): Promise<string | null> {
  return pickAgentCenterFileDialog({
    kind: 'file',
    title: 'Select background image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    ],
  });
}

export async function importAgentCenterLive2dAdapterManifest(input: {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
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

export async function importAgentCenterAvatarAsset(input: {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  kind: 'live2d' | 'vrm';
  sourcePath: string;
  displayName?: string;
  select?: boolean;
}): Promise<AgentCenterAvatarAssetImportResult> {
  requireTauri('desktop_agent_center_avatar_asset_import');
  return invokeChecked('desktop_agent_center_avatar_asset_import', {
    payload: input,
  }, parseAgentCenterAvatarAssetImportResult);
}

export async function validateAgentCenterAvatarAsset(input: {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  localAssetId: string;
}): Promise<AgentCenterAvatarAssetValidationResult> {
  requireTauri('desktop_agent_center_avatar_asset_validate');
  return invokeChecked('desktop_agent_center_avatar_asset_validate', {
    payload: input,
  }, parseAgentCenterAvatarAssetValidationResult);
}

export async function importAgentCenterBackground(input: {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
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

export async function removeAgentCenterBackground(input: {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
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
  runtimeSourceRef: string;
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
  runtimeSourceRef: string;
  localAgentRef: string;
  backgroundAssetId: string;
}): Promise<AgentCenterBackgroundAssetResult> {
  requireTauri('desktop_agent_center_background_asset_get');
  return invokeChecked('desktop_agent_center_background_asset_get', {
    payload: input,
  }, parseAgentCenterBackgroundAssetResult);
}
