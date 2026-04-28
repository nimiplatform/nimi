import { invoke } from '@tauri-apps/api/core';

export type AvatarLaunchAnchorMode = 'existing' | 'open_new';

export type AvatarLaunchContext = {
  agentCenterAccountId: string;
  agentId: string;
  avatarPackageKind: 'live2d' | 'vrm';
  avatarPackageId: string;
  avatarPackageSchemaVersion: 1;
  avatarInstanceId: string;
  conversationAnchorId: string | null;
  anchorMode: AvatarLaunchAnchorMode;
  launchedBy: string;
  runtimeAppId?: string | null;
  sourceSurface: string | null;
  worldId?: string | null;
};

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`avatar launch context is missing ${field}`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function parseAnchorMode(value: unknown): AvatarLaunchAnchorMode {
  if (value === 'existing' || value === 'open_new') {
    return value;
  }
  throw new Error('avatar launch context is missing a valid anchorMode');
}

function parseAvatarPackageKind(value: unknown): 'live2d' | 'vrm' {
  if (value === 'live2d' || value === 'vrm') {
    return value;
  }
  throw new Error('avatar launch context is missing a valid avatarPackageKind');
}

function parseAvatarPackageId(value: unknown, kind: 'live2d' | 'vrm'): string {
  const normalized = normalizeRequiredString(value, 'avatarPackageId');
  const pattern = kind === 'live2d' ? /^live2d_[a-f0-9]{12}$/u : /^vrm_[a-f0-9]{12}$/u;
  if (!pattern.test(normalized)) {
    throw new Error('avatar launch context avatarPackageId must match avatarPackageKind');
  }
  return normalized;
}

function parseAvatarPackageSchemaVersion(value: unknown): 1 {
  if (value === 1) {
    return 1;
  }
  throw new Error('avatar launch context requires avatarPackageSchemaVersion=1');
}

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  if (!value || typeof value !== 'object') {
    throw new Error('avatar launch context returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  const avatarPackageKind = parseAvatarPackageKind(record.avatarPackageKind);
  const context: AvatarLaunchContext = {
    agentCenterAccountId: normalizeRequiredString(record.agentCenterAccountId, 'agentCenterAccountId'),
    agentId: normalizeRequiredString(record.agentId, 'agentId'),
    avatarPackageKind,
    avatarPackageId: parseAvatarPackageId(record.avatarPackageId, avatarPackageKind),
    avatarPackageSchemaVersion: parseAvatarPackageSchemaVersion(record.avatarPackageSchemaVersion),
    avatarInstanceId: normalizeRequiredString(record.avatarInstanceId, 'avatarInstanceId'),
    conversationAnchorId: normalizeOptionalString(record.conversationAnchorId),
    anchorMode: parseAnchorMode(record.anchorMode),
    launchedBy: normalizeRequiredString(record.launchedBy, 'launchedBy'),
    runtimeAppId: normalizeOptionalString(record.runtimeAppId),
    sourceSurface: normalizeOptionalString(record.sourceSurface),
    worldId: normalizeOptionalString(record.worldId),
  };
  if (context.anchorMode === 'existing' && !context.conversationAnchorId) {
    throw new Error('avatar launch context requires conversationAnchorId when anchorMode=existing');
  }
  if (context.anchorMode === 'open_new' && context.conversationAnchorId) {
    throw new Error('avatar launch context must not include conversationAnchorId when anchorMode=open_new');
  }
  return context;
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invoke('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}
