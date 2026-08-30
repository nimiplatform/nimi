import {
  buildAvatarHostHandoffRequest,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  confirmDialog,
  invokeAvatarHostHandoffMechanic,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type DesktopAvatarLaunchHandoffInput = {
  agentHandle: string;
  conversationAnchorId?: string | null;
  avatarInstanceId?: string | null;
  launchSource?: string | null;
  sourceSurface?: string | null;
};

export type DesktopAvatarLaunchHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarLaunchHandoffPayload = {
  agentHandle: string;
  conversationAnchorId: string | null;
  avatarInstanceId?: string;
  launchSource?: string;
};

export type DesktopAvatarLaunchHandoffDeps = {
  invokeLaunchHandoff?: (request: AvatarHostHandoffRequest) => Promise<unknown>;
  confirmSwitch?: () => Promise<boolean>;
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

function normalizeRequiredPayloadString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`desktop avatar handoff returned invalid ${field}`);
  }
  return normalizeRequiredString(value, field);
}

// @nimi-authority: definition.nimi.desktop.agent-projection.avatar-surface
// @nimi-authority: rule.nimi.desktop.agent-projection.r016
// @nimi-authority: rule.nimi.desktop.agent-projection.r199
export function buildDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
): DesktopAvatarLaunchHandoffPayload {
  const agentHandle = normalizeRequiredAgentHandle(input.agentHandle);
  const conversationAnchorId = normalizeOptionalString(input.conversationAnchorId);
  const avatarInstanceId = normalizeOptionalString(input.avatarInstanceId);
  const launchSource = normalizeOptionalString(input.launchSource) ?? normalizeOptionalString(input.sourceSurface);
  return {
    agentHandle,
    conversationAnchorId,
    ...(avatarInstanceId ? { avatarInstanceId } : {}),
    ...(launchSource ? { launchSource } : {}),
  };
}

function normalizeRequiredAgentHandle(value: unknown): string {
  const handle = normalizeRequiredPayloadString(value, 'agentHandle');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    throw new Error('desktop avatar handoff requires a canonical agentHandle');
  }
  return handle;
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
  const invokeLaunch = deps.invokeLaunchHandoff ?? invokeAvatarHostHandoffMechanic;
  let result = await invokeDesktopAvatarLaunch(invokeLaunch, payload, null);
  if (result.state === 'confirmation-required') {
    const confirmed = await (deps.confirmSwitch
      ? deps.confirmSwitch()
      : confirmDesktopAvatarSwitch());
    if (!confirmed) return { opened: false, handoffUri: '' };
    result = await invokeDesktopAvatarLaunch(invokeLaunch, payload, result.switchIntentRef);
    if (result.state === 'confirmation-required') {
      throw new Error('desktop avatar switch confirmation did not converge');
    }
  }
  return {
    opened: result.state === 'present' || result.state === 'focused',
    handoffUri: result.avatarInstanceRef ?? '',
  };
}

async function invokeDesktopAvatarLaunch(
  invokeLaunch: (request: AvatarHostHandoffRequest) => Promise<unknown>,
  payload: DesktopAvatarLaunchHandoffPayload,
  switchIntentRef: string | null,
): Promise<AvatarHostHandoffResult> {
  const request = buildAvatarHostHandoffRequest({
    command: 'launch',
    target: {
      agentHandle: payload.agentHandle,
      conversationAnchorId: payload.conversationAnchorId,
      avatarInstanceId: payload.avatarInstanceId ?? null,
      launchSource: payload.launchSource ?? null,
      switchIntentRef,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  });
  return parseAvatarHostHandoffResult(await invokeLaunch(request), 'launch');
}

async function confirmDesktopAvatarSwitch(): Promise<boolean> {
  const result = await confirmDialog({
    title: 'Switch current companion?',
    description: 'Another companion is already active. Switch the desktop companion to this Agent?',
    level: 'warning',
  });
  return result.confirmed;
}

function sanitizeInstanceSegment(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed || 'unknown';
}

export function buildDesktopAvatarInstanceId(input: {
  agentHandle: string;
}): string {
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'agentHandle')) {
    throw new Error('desktop avatar instance id must depend only on Agent identity');
  }
  const agentSegment = sanitizeInstanceSegment(
    normalizeRequiredAgentHandle(input.agentHandle),
  );
  return `desktop-avatar-${agentSegment}`;
}
