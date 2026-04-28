import { getPlatformClient } from '@nimiplatform/sdk';
import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchAnchorMode = 'existing' | 'open_new';

const DESKTOP_RUNTIME_APP_ID = 'nimi.desktop';
const DESKTOP_RUNTIME_APP_INSTANCE_ID = 'nimi.desktop.local-first-party';
const DESKTOP_RUNTIME_DEVICE_ID = 'desktop-shell';
const DESKTOP_ACCOUNT_CALLER_MODE_DESKTOP_SHELL = 2;
const AVATAR_BINDING_PURPOSE = 'avatar.interaction.consume';
const AVATAR_BINDING_PURPOSE_PROTO = 1;
const AVATAR_BINDING_TTL_SECONDS = 60 * 60;
const AVATAR_BINDING_READ_SCOPES = [
  'runtime.agent.turn.read',
  'runtime.agent.presentation.read',
  'runtime.agent.state.read',
] as const;
const AVATAR_BINDING_WRITE_SCOPE = 'runtime.agent.turn.write';

export type DesktopAvatarLaunchHandoffInput = {
  agentId: string;
  avatarPackage: {
    kind: 'live2d' | 'vrm';
    packageId: string;
    schemaVersion?: 1;
  };
  avatarInstanceId: string;
  conversationAnchorId?: string | null;
  anchorMode: DesktopAvatarLaunchAnchorMode;
  inputEnabled?: boolean;
  launchedBy?: string;
  runtimeAppId?: string;
  sourceSurface?: string;
  worldId?: string | null;
};

export type DesktopAvatarLaunchHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarCloseHandoffInput = {
  avatarInstanceId: string;
  bindingId?: string | null;
  closedBy?: string;
  sourceSurface?: string;
};

export type DesktopAvatarCloseHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarLaunchHandoffPayload = {
  agentId: string;
  avatarPackageKind: 'live2d' | 'vrm';
  avatarPackageId: string;
  avatarPackageSchemaVersion: 1;
  avatarInstanceId: string;
  conversationAnchorId: string;
  launchedBy: string;
  runtimeAppId: string;
  sourceSurface: string;
  worldId: string | null;
  scopedBinding: DesktopAvatarScopedBindingProjection;
};

export type DesktopAvatarScopedBindingProjection = {
  bindingId: string;
  bindingHandle: string | null;
  runtimeAppId: string;
  appInstanceId: string;
  windowId: string;
  avatarInstanceId: string;
  agentId: string;
  conversationAnchorId: string;
  worldId: string | null;
  purpose: typeof AVATAR_BINDING_PURPOSE;
  scopes: string[];
  issuedAt: string | null;
  expiresAt: string | null;
  state: string;
  reasonCode: string;
};

type DesktopAvatarLaunchTarget = {
  runtimeAppId: string;
  avatarInstanceId: string;
  agentId: string;
  conversationAnchorId: string;
  worldId: string | null;
  scopes: string[];
};

type RuntimeTimestampLike = {
  seconds?: number | string | bigint;
  nanos?: number;
};

type ScopedBindingIssueResponse = {
  accepted?: boolean;
  bindingId?: string;
  bindingCarrier?: string;
  relation?: {
    bindingId?: string;
    runtimeAppId?: string;
    appInstanceId?: string;
    windowId?: string;
    avatarInstanceId?: string;
    agentId?: string;
    conversationAnchorId?: string;
    worldId?: string;
    scopes?: string[];
    issuedAt?: RuntimeTimestampLike;
    expiresAt?: RuntimeTimestampLike;
    state?: number | string;
    reasonCode?: number | string;
  };
  reasonCode?: number | string;
  accountReasonCode?: number | string;
};

export type DesktopAvatarLaunchHandoffDeps = {
  reserveConversationAnchor?: (input: {
    agentId: string;
    avatarInstanceId: string;
    launchedBy: string;
    sourceSurface: string;
  }) => Promise<string>;
  issueScopedAppBinding?: (input: DesktopAvatarLaunchTarget) => Promise<DesktopAvatarScopedBindingProjection>;
  invokeLaunchHandoff?: (payload: DesktopAvatarLaunchHandoffPayload) => Promise<DesktopAvatarLaunchHandoffResult>;
};

export type DesktopAvatarCloseHandoffDeps = {
  revokeScopedAppBinding?: (input: { bindingId: string }) => Promise<void>;
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

function normalizeAnchorMode(value: string): DesktopAvatarLaunchAnchorMode {
  const normalized = normalizeRequiredString(value, 'anchorMode');
  if (normalized !== 'existing' && normalized !== 'open_new') {
    throw new Error('desktop avatar handoff requires anchorMode to be existing or open_new');
  }
  return normalized;
}

function normalizeWorldId(value: string | null | undefined): string | null {
  return normalizeOptionalString(value);
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

function avatarBindingScopes(inputEnabled: boolean | undefined): string[] {
  return inputEnabled === false
    ? [...AVATAR_BINDING_READ_SCOPES]
    : [...AVATAR_BINDING_READ_SCOPES, AVATAR_BINDING_WRITE_SCOPE];
}

function timestampToIso(value: RuntimeTimestampLike | null | undefined): string | null {
  if (!value || value.seconds === undefined || value.seconds === null) {
    return null;
  }
  const seconds = typeof value.seconds === 'bigint'
    ? Number(value.seconds)
    : Number(value.seconds);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const millis = seconds * 1000 + Math.floor(Number(value.nanos || 0) / 1_000_000);
  const iso = new Date(millis).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function scopedBindingStateName(value: number | string | null | undefined): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return value === 2 ? 'active' : String(value || 'active');
}

function accountReasonCodeName(value: number | string | null | undefined): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return value === 1 ? 'action_executed' : String(value || 'action_executed');
}

function normalizeBindingProjection(input: {
  target: DesktopAvatarLaunchTarget;
  response: ScopedBindingIssueResponse;
}): DesktopAvatarScopedBindingProjection {
  const relation = input.response.relation || {};
  const bindingId = normalizeRequiredString(
    input.response.bindingId || relation.bindingId || '',
    'scopedBinding.bindingId',
  );
  const relationRuntimeAppId = normalizeRequiredString(
    relation.runtimeAppId || input.target.runtimeAppId,
    'scopedBinding.runtimeAppId',
  );
  const relationAvatarInstanceId = normalizeRequiredString(
    relation.avatarInstanceId || input.target.avatarInstanceId,
    'scopedBinding.avatarInstanceId',
  );
  const relationAgentId = normalizeRequiredString(
    relation.agentId || input.target.agentId,
    'scopedBinding.agentId',
  );
  const relationAnchorId = normalizeRequiredString(
    relation.conversationAnchorId || input.target.conversationAnchorId,
    'scopedBinding.conversationAnchorId',
  );
  if (
    relationRuntimeAppId !== input.target.runtimeAppId
    || relationAvatarInstanceId !== input.target.avatarInstanceId
    || relationAgentId !== input.target.agentId
    || relationAnchorId !== input.target.conversationAnchorId
  ) {
    throw new Error('runtime scoped binding relation does not match desktop avatar launch target');
  }
  const scopes = (relation.scopes?.length ? relation.scopes : input.target.scopes)
    .map((scope) => normalizeRequiredString(scope, 'scopedBinding.scope'));
  return {
    bindingId,
    bindingHandle: normalizeOptionalString(input.response.bindingCarrier),
    runtimeAppId: relationRuntimeAppId,
    appInstanceId: normalizeRequiredString(relation.appInstanceId || '', 'scopedBinding.appInstanceId'),
    windowId: normalizeRequiredString(relation.windowId || '', 'scopedBinding.windowId'),
    avatarInstanceId: relationAvatarInstanceId,
    agentId: relationAgentId,
    conversationAnchorId: relationAnchorId,
    worldId: normalizeWorldId(relation.worldId || input.target.worldId),
    purpose: AVATAR_BINDING_PURPOSE,
    scopes,
    issuedAt: timestampToIso(relation.issuedAt),
    expiresAt: timestampToIso(relation.expiresAt),
    state: scopedBindingStateName(relation.state),
    reasonCode: accountReasonCodeName(relation.reasonCode || input.response.accountReasonCode),
  };
}

export function buildDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
  scopedBinding: DesktopAvatarScopedBindingProjection,
): DesktopAvatarLaunchHandoffPayload {
  const anchorMode = normalizeAnchorMode(input.anchorMode);
  const conversationAnchorId = normalizeOptionalString(input.conversationAnchorId);
  const avatarPackageKind = normalizeAvatarPackageKind(input.avatarPackage?.kind || '');
  const avatarPackageId = normalizeAvatarPackageId(input.avatarPackage?.packageId || '', avatarPackageKind);
  const avatarPackageSchemaVersion = input.avatarPackage.schemaVersion || 1;
  if (avatarPackageSchemaVersion !== 1) {
    throw new Error('desktop avatar handoff requires avatarPackage.schemaVersion=1');
  }
  if (!conversationAnchorId) {
    throw new Error('desktop avatar handoff requires committed conversationAnchorId before launch');
  }
  if (anchorMode === 'open_new' && !conversationAnchorId) {
    throw new Error('desktop avatar handoff must reserve conversationAnchorId before formerly open_new launch');
  }
  const runtimeAppId = input.runtimeAppId || DESKTOP_RUNTIME_APP_ID;
  const avatarInstanceId = normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId');
  const agentId = normalizeRequiredString(input.agentId, 'agentId');
  if (
    scopedBinding.runtimeAppId !== runtimeAppId
    || scopedBinding.avatarInstanceId !== avatarInstanceId
    || scopedBinding.agentId !== agentId
    || scopedBinding.conversationAnchorId !== conversationAnchorId
  ) {
    throw new Error('desktop avatar handoff scoped binding must match committed launch target');
  }
  return {
    agentId,
    avatarPackageKind,
    avatarPackageId,
    avatarPackageSchemaVersion,
    avatarInstanceId,
    conversationAnchorId,
    launchedBy: input.launchedBy || 'nimi.desktop',
    runtimeAppId,
    sourceSurface: input.sourceSurface || 'desktop-agent-chat',
    worldId: normalizeWorldId(input.worldId),
    scopedBinding,
  };
}

async function defaultReserveConversationAnchor(input: {
  agentId: string;
  avatarInstanceId: string;
  launchedBy: string;
  sourceSurface: string;
}): Promise<string> {
  const runtime = getPlatformClient().runtime;
  const opened = await runtime.agent.anchors.open({
    agentId: input.agentId,
    metadata: {
      surface: 'desktop-agent-chat',
      launchedBy: input.launchedBy,
      avatarInstanceId: input.avatarInstanceId,
      sourceSurface: input.sourceSurface,
    },
  });
  const record = opened as unknown as Record<string, unknown>;
  const anchorRecord = record.anchor && typeof record.anchor === 'object'
    ? record.anchor as Record<string, unknown>
    : null;
  return normalizeRequiredString(
    String(anchorRecord?.conversationAnchorId
      ?? anchorRecord?.conversation_anchor_id
      ?? record.conversationAnchorId
      ?? record.conversation_anchor_id
      ?? ''),
    'conversationAnchorId from runtime anchor reservation',
  );
}

async function defaultIssueScopedAppBinding(
  target: DesktopAvatarLaunchTarget,
): Promise<DesktopAvatarScopedBindingProjection> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.account.issueScopedAppBinding({
    caller: {
      appId: DESKTOP_RUNTIME_APP_ID,
      appInstanceId: DESKTOP_RUNTIME_APP_INSTANCE_ID,
      deviceId: DESKTOP_RUNTIME_DEVICE_ID,
      mode: DESKTOP_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
      scopes: [],
    },
    relation: {
      bindingId: '',
      runtimeAppId: target.runtimeAppId,
      appInstanceId: DESKTOP_RUNTIME_APP_INSTANCE_ID,
      windowId: 'desktop-agent-chat',
      avatarInstanceId: target.avatarInstanceId,
      agentId: target.agentId,
      conversationAnchorId: target.conversationAnchorId,
      worldId: target.worldId || '',
      purpose: AVATAR_BINDING_PURPOSE_PROTO,
      scopes: target.scopes,
      state: 0,
      reasonCode: 0,
    },
    ttlSeconds: AVATAR_BINDING_TTL_SECONDS,
  }) as ScopedBindingIssueResponse;
  if (!response.accepted) {
    throw new Error(
      `runtime scoped avatar binding rejected: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
    );
  }
  return normalizeBindingProjection({ target, response });
}

export async function prepareDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
  deps: DesktopAvatarLaunchHandoffDeps = {},
): Promise<DesktopAvatarLaunchHandoffPayload> {
  const anchorMode = normalizeAnchorMode(input.anchorMode);
  const launchedBy = input.launchedBy || 'nimi.desktop';
  const sourceSurface = input.sourceSurface || 'desktop-agent-chat';
  const reserveConversationAnchor = deps.reserveConversationAnchor || defaultReserveConversationAnchor;
  const reservedConversationAnchorId = anchorMode === 'existing'
    ? normalizeRequiredString(String(input.conversationAnchorId || ''), 'conversationAnchorId')
    : await reserveConversationAnchor({
      agentId: normalizeRequiredString(input.agentId, 'agentId'),
      avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
      launchedBy,
      sourceSurface,
    });
  const conversationAnchorId = normalizeRequiredString(
    reservedConversationAnchorId,
    'committed conversationAnchorId',
  );
  const target: DesktopAvatarLaunchTarget = {
    runtimeAppId: input.runtimeAppId || DESKTOP_RUNTIME_APP_ID,
    avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
    agentId: normalizeRequiredString(input.agentId, 'agentId'),
    conversationAnchorId,
    worldId: normalizeWorldId(input.worldId),
    scopes: avatarBindingScopes(input.inputEnabled),
  };
  const issueScopedAppBinding = deps.issueScopedAppBinding || defaultIssueScopedAppBinding;
  const scopedBinding = await issueScopedAppBinding(target);
  return buildDesktopAvatarLaunchHandoffPayload(
    {
      ...input,
      launchedBy,
      sourceSurface,
      conversationAnchorId,
      anchorMode,
      runtimeAppId: target.runtimeAppId,
      worldId: target.worldId,
    },
    scopedBinding,
  );
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

async function defaultRevokeScopedAppBinding(input: { bindingId: string }): Promise<void> {
  const runtime = getPlatformClient().runtime;
  const response = await runtime.account.revokeScopedAppBinding({
    caller: {
      appId: DESKTOP_RUNTIME_APP_ID,
      appInstanceId: DESKTOP_RUNTIME_APP_INSTANCE_ID,
      deviceId: DESKTOP_RUNTIME_DEVICE_ID,
      mode: DESKTOP_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
      scopes: [],
    },
    bindingId: input.bindingId,
    reasonCode: 1,
  });
  if (!response.accepted) {
    throw new Error(
      `runtime scoped avatar binding revoke rejected: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`,
    );
  }
}

export async function closeDesktopAvatarHandoff(
  input: DesktopAvatarCloseHandoffInput,
  deps: DesktopAvatarCloseHandoffDeps = {},
): Promise<DesktopAvatarCloseHandoffResult> {
  const bindingId = normalizeOptionalString(input.bindingId);
  if (bindingId) {
    await (deps.revokeScopedAppBinding || defaultRevokeScopedAppBinding)({ bindingId });
  }
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
