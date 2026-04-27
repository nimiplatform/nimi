import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchAnchorMode = 'existing' | 'open_new';

export type DesktopAvatarLaunchHandoffInput = {
  accountId: string;
  agentId: string;
  avatarPackage: {
    kind: 'live2d' | 'vrm';
    packageId: string;
    schemaVersion?: 1;
  };
  avatarInstanceId: string;
  conversationAnchorId?: string | null;
  anchorMode: DesktopAvatarLaunchAnchorMode;
  launchedBy?: string;
  runtimeAppId?: string;
  sourceSurface?: string;
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
  agentCenterAccountId: string;
  agentId: string;
  avatarPackageKind: 'live2d' | 'vrm';
  avatarPackageId: string;
  avatarPackageSchemaVersion: 1;
  avatarInstanceId: string;
  conversationAnchorId: string | null;
  anchorMode: DesktopAvatarLaunchAnchorMode;
  launchedBy: string;
  runtimeAppId: string;
  sourceSurface: string;
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

function normalizeAnchorMode(value: string): DesktopAvatarLaunchAnchorMode {
  const normalized = normalizeRequiredString(value, 'anchorMode');
  if (normalized !== 'existing' && normalized !== 'open_new') {
    throw new Error('desktop avatar handoff requires anchorMode to be existing or open_new');
  }
  return normalized;
}

function normalizeAvatarPackageKind(value: string): 'live2d' | 'vrm' {
  const normalized = normalizeRequiredString(value, 'avatarPackage.kind');
  if (normalized !== 'live2d' && normalized !== 'vrm') {
    throw new Error('desktop avatar handoff requires avatarPackage.kind to be live2d or vrm');
  }
  return normalized;
}

function normalizeAvatarPackageId(value: string, kind: 'live2d' | 'vrm'): string {
  const normalized = normalizeRequiredString(value, 'avatarPackage.packageId');
  const pattern = kind === 'live2d' ? /^live2d_[a-f0-9]{12}$/u : /^vrm_[a-f0-9]{12}$/u;
  if (!pattern.test(normalized)) {
    throw new Error('desktop avatar handoff requires avatarPackage.packageId to match avatarPackage.kind');
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
  const anchorMode = normalizeAnchorMode(input.anchorMode);
  const conversationAnchorId = normalizeOptionalString(input.conversationAnchorId);
  const avatarPackageKind = normalizeAvatarPackageKind(input.avatarPackage?.kind || '');
  const avatarPackageId = normalizeAvatarPackageId(input.avatarPackage?.packageId || '', avatarPackageKind);
  const avatarPackageSchemaVersion = input.avatarPackage.schemaVersion || 1;
  if (avatarPackageSchemaVersion !== 1) {
    throw new Error('desktop avatar handoff requires avatarPackage.schemaVersion=1');
  }
  if (anchorMode === 'existing' && !conversationAnchorId) {
    throw new Error('desktop avatar handoff requires conversationAnchorId when anchorMode=existing');
  }
  if (anchorMode === 'open_new' && conversationAnchorId) {
    throw new Error('desktop avatar handoff must omit conversationAnchorId when anchorMode=open_new');
  }
  return {
    agentCenterAccountId: normalizeRequiredString(input.accountId, 'accountId'),
    agentId: normalizeRequiredString(input.agentId, 'agentId'),
    avatarPackageKind,
    avatarPackageId,
    avatarPackageSchemaVersion,
    avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
    conversationAnchorId,
    anchorMode,
    launchedBy: input.launchedBy || 'nimi.desktop',
    runtimeAppId: input.runtimeAppId || 'nimi.desktop',
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

export async function closeDesktopAvatarHandoff(
  input: DesktopAvatarCloseHandoffInput,
): Promise<DesktopAvatarCloseHandoffResult> {
  return invokeChecked('desktop_avatar_close_handoff', {
    payload: {
      avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
      closedBy: input.closedBy || 'desktop',
      sourceSurface: input.sourceSurface || 'desktop-agent-chat',
    },
  }, parseDesktopAvatarCloseHandoffResult);
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

export function buildDesktopAvatarEphemeralInstanceId(input: {
  agentId: string;
  threadId?: string | null;
  conversationAnchorId?: string | null;
  nonce?: string | null;
}): string {
  const baseId = buildDesktopAvatarInstanceId(input);
  const nonce = sanitizeInstanceSegment(
    input.nonce || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return `${baseId}-${nonce}`;
}
