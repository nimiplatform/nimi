import { invoke } from '@tauri-apps/api/core';

export type AvatarLaunchAnchorMode = 'existing' | 'open_new';

export type AvatarLaunchContext = {
  agentId: string;
  avatarInstanceId: string;
  conversationAnchorId: string | null;
  anchorMode: AvatarLaunchAnchorMode;
  launchedBy: string;
  sourceSurface: string | null;
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

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  if (!value || typeof value !== 'object') {
    throw new Error('avatar launch context returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  const context: AvatarLaunchContext = {
    agentId: normalizeRequiredString(record.agentId, 'agentId'),
    avatarInstanceId: normalizeRequiredString(record.avatarInstanceId, 'avatarInstanceId'),
    conversationAnchorId: normalizeOptionalString(record.conversationAnchorId),
    anchorMode: parseAnchorMode(record.anchorMode),
    launchedBy: normalizeRequiredString(record.launchedBy, 'launchedBy'),
    sourceSurface: normalizeOptionalString(record.sourceSurface),
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
