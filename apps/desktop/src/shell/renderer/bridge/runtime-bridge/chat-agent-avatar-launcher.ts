import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchAnchorMode = 'existing' | 'open_new';

export type DesktopAvatarLaunchHandoffInput = {
  agentId: string;
  avatarInstanceId: string;
  conversationAnchorId?: string | null;
  anchorMode: DesktopAvatarLaunchAnchorMode;
  launchedBy?: string;
  sourceSurface?: string;
};

export type DesktopAvatarLaunchHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarLaunchHandoffPayload = {
  agentId: string;
  avatarInstanceId: string;
  conversationAnchorId: string | null;
  anchorMode: DesktopAvatarLaunchAnchorMode;
  launchedBy: string;
  sourceSurface: string;
};

function normalizeRequiredString(value: string, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`desktop avatar handoff requires ${field}`);
  }
  return normalized;
}

export function parseDesktopAvatarLaunchHandoffResult(value: unknown): DesktopAvatarLaunchHandoffResult {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop avatar handoff returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  return {
    opened: Boolean(record.opened),
    handoffUri: normalizeRequiredString(String(record.handoffUri || ''), 'handoffUri'),
  };
}

export function buildDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
): DesktopAvatarLaunchHandoffPayload {
  return {
    agentId: normalizeRequiredString(input.agentId, 'agentId'),
    avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
    conversationAnchorId: input.conversationAnchorId ?? null,
    anchorMode: normalizeRequiredString(input.anchorMode, 'anchorMode') as DesktopAvatarLaunchAnchorMode,
    launchedBy: input.launchedBy || 'desktop',
    sourceSurface: input.sourceSurface || 'desktop-agent-chat',
  };
}

export async function launchDesktopAvatarHandoff(
  input: DesktopAvatarLaunchHandoffInput,
): Promise<DesktopAvatarLaunchHandoffResult> {
  return invokeChecked('desktop_avatar_launch_handoff', {
    payload: buildDesktopAvatarLaunchHandoffPayload(input),
  }, parseDesktopAvatarLaunchHandoffResult);
}

function sanitizeInstanceSegment(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed || 'unknown';
}

export function buildDesktopAvatarInstanceId(input: {
  agentId: string;
  threadId?: string | null;
  conversationAnchorId?: string | null;
}): string {
  const agentSegment = sanitizeInstanceSegment(input.agentId);
  const continuitySegment = sanitizeInstanceSegment(
    input.threadId || input.conversationAnchorId || 'open-new-anchor',
  );
  return `desktop-avatar-${agentSegment}-${continuitySegment}`;
}
