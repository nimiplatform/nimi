export type ZhiyuAgentCenterAvatarAssetKind = 'live2d' | 'vrm';

export type ZhiyuAgentCenterLocalConfigScope = {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export type ZhiyuAgentCenterAvatarAssetModule = {
  readonly schema_version: 1;
  readonly conversation_anchor_scope: 'current_anchor' | 'explicit_debug_anchor' | 'no_anchor';
  readonly local_avatar_asset_ref: string | null;
  readonly live2d_adapter_manifest_source: 'none' | 'embedded_creator_manifest' | 'external_sidecar_manifest';
  readonly live2d_adapter_manifest_ref: string | null;
  readonly live2d_calibration_ref: string | null;
  readonly avatar_instance_policy: 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection';
  readonly backend_kind: 'live2d' | 'vrm' | 'future';
  readonly backend_capability_profile_ref: string | null;
  readonly generated_motion_provider_policy: 'require_profile_support' | 'disable_generated_motion' | 'debug_only';
  readonly launch_mode: 'manual' | 'debug_session' | 'start_with_chat';
  readonly debug_profile: 'standard' | 'strict_backend_evidence' | 'route_matrix';
  readonly updated_at: string;
  readonly provenance: {
    readonly source: 'user_selection' | 'import_validation' | 'runtime_projection' | 'avatar_backend_evidence';
    readonly evidence_ref: string;
  };
};

export type ZhiyuAgentCenterLocalConfig = {
  readonly schema_version: 1;
  readonly config_kind: 'agent_center_local_config';
  readonly account_id: string;
  readonly owner_user_id: string;
  readonly runtime_source_ref: string;
  readonly local_agent_ref: string;
  readonly modules: {
    readonly appearance: {
      readonly schema_version: 1;
      readonly background_asset_id: string | null;
      readonly motion: 'system' | 'reduced' | 'full';
    };
    readonly avatar_asset: ZhiyuAgentCenterAvatarAssetModule;
    readonly local_history: {
      readonly schema_version: 1;
      readonly last_cleared_at: string | null;
    };
    readonly voice: {
      readonly schema_version: 1;
      readonly avatar_autoplay: boolean;
    };
    readonly ui: {
      readonly schema_version: 1;
      readonly last_section: 'overview' | 'appearance' | 'chat_behavior' | 'model' | 'cognition' | 'advanced';
    };
  };
};

export type ZhiyuAgentCenterLocalConfigBridge = {
  readonly invoke: (command: string, payload: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Window {
    readonly __nimiZhiyuAgentCenterLocalConfig?: ZhiyuAgentCenterLocalConfigBridge;
  }
}

export function hasZhiyuAgentCenterLocalConfigBridge(): boolean {
  return Boolean(agentCenterBridge());
}

export async function getZhiyuAgentCenterLocalConfig(
  scope: ZhiyuAgentCenterLocalConfigScope,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return assertConfig(await invokeAgentCenter('config.get', scope));
}

export async function putZhiyuAgentCenterLocalConfig(
  config: ZhiyuAgentCenterLocalConfig,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return assertConfig(await invokeAgentCenter('config.put', { config }));
}

export async function importZhiyuAgentCenterAvatarAsset(input: {
  readonly scope: ZhiyuAgentCenterLocalConfigScope;
  readonly kind: ZhiyuAgentCenterAvatarAssetKind;
}): Promise<boolean> {
  const sourcePath = await invokeAgentCenter(
    input.kind === 'live2d' ? 'avatar.pickLive2dSource' : 'avatar.pickVrmSource',
    {},
  );
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('avatar.import', {
    ...input.scope,
    kind: input.kind,
    sourcePath,
    select: true,
  });
  return true;
}

export async function importZhiyuAgentCenterLive2dAdapterManifest(input: {
  readonly scope: ZhiyuAgentCenterLocalConfigScope;
  readonly localAssetId: string;
}): Promise<boolean> {
  const sourcePath = await invokeAgentCenter('avatar.pickLive2dAdapterManifest', {});
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('avatar.importLive2dAdapterManifest', {
    ...input.scope,
    localAssetId: input.localAssetId,
    sourcePath,
    select: true,
  });
  return true;
}

export async function importZhiyuAgentCenterBackground(
  scope: ZhiyuAgentCenterLocalConfigScope,
): Promise<boolean> {
  const sourcePath = await invokeAgentCenter('background.pickSource', {});
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('background.import', {
    ...scope,
    sourcePath,
    select: true,
  });
  return true;
}

export async function clearZhiyuAgentCenterAvatarAsset(
  config: ZhiyuAgentCenterLocalConfig,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return putZhiyuAgentCenterLocalConfig({
    ...config,
    modules: {
      ...config.modules,
      avatar_asset: {
        ...config.modules.avatar_asset,
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        live2d_calibration_ref: null,
        backend_capability_profile_ref: null,
        updated_at: new Date().toISOString(),
        provenance: {
          source: 'user_selection',
          evidence_ref: 'zhiyu-agent-center-avatar-selection-cleared',
        },
      },
    },
  });
}

export async function clearZhiyuAgentCenterBackground(
  scope: ZhiyuAgentCenterLocalConfigScope,
  backgroundAssetId: string,
): Promise<void> {
  await invokeAgentCenter('background.remove', {
    ...scope,
    backgroundAssetId,
  });
}

async function invokeAgentCenter(command: string, payload: Record<string, unknown>): Promise<unknown> {
  const bridge = agentCenterBridge();
  if (!bridge) {
    throw new Error('Zhiyu Agent Center local config bridge is unavailable.');
  }
  return bridge.invoke(command, payload);
}

function agentCenterBridge(): ZhiyuAgentCenterLocalConfigBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__nimiZhiyuAgentCenterLocalConfig ?? null;
}

function assertConfig(value: unknown): ZhiyuAgentCenterLocalConfig {
  if (!isRecord(value)) {
    throw new Error('Zhiyu Agent Center local config response must be an object.');
  }
  if (value.schema_version !== 1 || value.config_kind !== 'agent_center_local_config') {
    throw new Error('Zhiyu Agent Center local config response has invalid schema.');
  }
  const modules = value.modules;
  if (!isRecord(modules) || !isRecord(modules.avatar_asset) || !isRecord(modules.appearance)) {
    throw new Error('Zhiyu Agent Center local config response is missing modules.');
  }
  return value as ZhiyuAgentCenterLocalConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
