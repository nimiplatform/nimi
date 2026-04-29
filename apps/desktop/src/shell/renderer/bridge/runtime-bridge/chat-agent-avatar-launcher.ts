import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchHandoffInput = {
  agentId: string;
  avatarInstanceId?: string | null;
  launchSource?: string | null;
  sourceSurface?: string | null;
};

export type DesktopAvatarLaunchHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarCloseHandoffInput = {
  avatarInstanceId: string;
  closedBy?: string;
  sourceSurface?: string;
};

export type DesktopAvatarCloseHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarLaunchHandoffPayload = {
  agentId: string;
  avatarInstanceId?: string;
  launchSource?: string;
  sourceSurface?: string;
};

const FORBIDDEN_LAUNCH_INPUT_FIELDS = [
  'avatarPackage',
  'avatarPackageKind',
  'avatarPackageId',
  'avatarPackageSchemaVersion',
  'conversationAnchorId',
  'anchorMode',
  'runtimeAppId',
  'worldId',
  'scopedBinding',
  'bindingId',
  'bindingHandle',
  'scopes',
  'state',
  'reason',
  'accountId',
  'userId',
  'subjectUserId',
  'realmBaseUrl',
  'realmUrl',
  'accessToken',
  'refreshToken',
  'jwt',
] as const;

export type DesktopAvatarLaunchHandoffDeps = {
  invokeLaunchHandoff?: (payload: DesktopAvatarLaunchHandoffPayload) => Promise<DesktopAvatarLaunchHandoffResult>;
};

export type DesktopAvatarCloseHandoffDeps = {
  invokeCloseHandoff?: (payload: {
    avatarInstanceId: string;
    closedBy: string;
    sourceSurface: string;
  }) => Promise<DesktopAvatarCloseHandoffResult>;
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

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

export function parseDesktopAvatarCloseHandoffResult(value: unknown): DesktopAvatarCloseHandoffResult {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop avatar close handoff returned invalid payload');
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
  const record = input as Record<string, unknown>;
  for (const field of FORBIDDEN_LAUNCH_INPUT_FIELDS) {
    if (field in record) {
      throw new Error(`desktop avatar handoff contains forbidden field: ${field}`);
    }
  }
  const agentId = normalizeRequiredString(input.agentId, 'agentId');
  const avatarInstanceId = normalizeOptionalString(input.avatarInstanceId);
  const launchSource = normalizeOptionalString(input.launchSource);
  const sourceSurface = normalizeOptionalString(input.sourceSurface);
  return {
    agentId,
    ...(avatarInstanceId ? { avatarInstanceId } : {}),
    ...(launchSource ? { launchSource } : {}),
    ...(sourceSurface ? { sourceSurface } : {}),
  };
}

export async function prepareDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
  _deps: DesktopAvatarLaunchHandoffDeps = {},
): Promise<DesktopAvatarLaunchHandoffPayload> {
  return buildDesktopAvatarLaunchHandoffPayload(input);
}

export async function launchDesktopAvatarHandoff(
  input: DesktopAvatarLaunchHandoffInput,
  deps: DesktopAvatarLaunchHandoffDeps = {},
): Promise<DesktopAvatarLaunchHandoffResult> {
  const payload = await prepareDesktopAvatarLaunchHandoffPayload(input, deps);
  if (deps.invokeLaunchHandoff) {
    return deps.invokeLaunchHandoff(payload);
  }
  return invokeChecked('desktop_avatar_launch_handoff', { payload }, parseDesktopAvatarLaunchHandoffResult);
}

export async function closeDesktopAvatarHandoff(
  input: DesktopAvatarCloseHandoffInput,
  deps: DesktopAvatarCloseHandoffDeps = {},
): Promise<DesktopAvatarCloseHandoffResult> {
  const payload = {
    avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
    closedBy: input.closedBy || 'desktop',
    sourceSurface: input.sourceSurface || 'desktop-agent-chat',
  };
  if (deps.invokeCloseHandoff) {
    return deps.invokeCloseHandoff(payload);
  }
  return invokeChecked('desktop_avatar_close_handoff', { payload }, parseDesktopAvatarCloseHandoffResult);
}

function sanitizeInstanceSegment(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed || 'unknown';
}

export function buildDesktopAvatarInstanceId(input: {
  agentId: string;
  threadId?: string | null;
}): string {
  const record = input as Record<string, unknown>;
  if ('conversationAnchorId' in record) {
    throw new Error('desktop avatar instance id must not depend on conversationAnchorId');
  }
  const agentSegment = sanitizeInstanceSegment(input.agentId);
  const continuitySegment = sanitizeInstanceSegment(input.threadId || 'default');
  return `desktop-avatar-${agentSegment}-${continuitySegment}`;
}

export function buildDesktopAvatarEphemeralInstanceId(input: {
  agentId: string;
  threadId?: string | null;
  nonce?: string | null;
}): string {
  const baseId = buildDesktopAvatarInstanceId(input);
  const nonce = sanitizeInstanceSegment(
    input.nonce || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return `${baseId}-${nonce}`;
}
