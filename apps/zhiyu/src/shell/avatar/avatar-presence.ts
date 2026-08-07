import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from '../agent/local-agent-status';

export type ZhiyuAvatarPresenceStatus = ZhiyuEvidence['avatar'];

export interface ZhiyuAvatarPresenceReadInput {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export interface ZhiyuAvatarPresenceProjection {
  readonly configurationRef?: string | null;
  readonly launchAvailable?: boolean;
  readonly manageAvailable?: boolean;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly source?: string;
  readonly message?: string;
}

export type ZhiyuAvatarPresenceReader = (
  input: ZhiyuAvatarPresenceReadInput,
) => Promise<ZhiyuAvatarPresenceProjection | null | undefined>;

export interface ZhiyuAvatarPresenceProbeOptions {
  readonly readAvatarPresence?: ZhiyuAvatarPresenceReader;
}

export async function probeZhiyuAvatarPresence(
  localAgent: ZhiyuLocalAgentStatus,
  options: ZhiyuAvatarPresenceProbeOptions = {},
): Promise<ZhiyuAvatarPresenceStatus> {
  if (localAgent.ready && stringOr(localAgent.source, '') !== 'runtime') {
    return avatarUnavailable({
      reasonCode: 'zhiyu-runtime-owned-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires Runtime-owned LocalAgent evidence before reading Avatar presence.',
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return avatarUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires a Runtime-owned LocalAgent before reading Avatar presence.',
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }

  if (!options.readAvatarPresence) {
    return avatarUnavailable({
      reasonCode: 'zhiyu-avatar-presence-capability-not-admitted',
      actionHint: 'admit_zhiyu_avatar_presence_capability',
      source: 'sdk',
      message: 'Avatar presence is not admitted on the Zhiyu local-app carrier.',
      ...identity,
    });
  }

  try {
    const projection = await options.readAvatarPresence(identity);
    return avatarAvailable(projection, identity);
  } catch (error) {
    return normalizeAvatarPresenceError(error, identity);
  }
}

function avatarAvailable(
  projection: ZhiyuAvatarPresenceProjection | null | undefined,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuAvatarPresenceStatus {
  const configurationRef = stringOr(projection?.configurationRef, '');
  if (!configurationRef) {
    return avatarUnavailable({
      reasonCode: stringOr(projection?.reasonCode, 'zhiyu-avatar-configuration-not-projected'),
      actionHint: stringOr(projection?.actionHint, 'provide_avatar_configuration_projection'),
      source: stringOr(projection?.source, 'sdk'),
      message: stringOr(
        projection?.message,
        'Avatar facade projection did not include an admitted configuration reference.',
      ),
      ...identity,
    });
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: stringOr(projection?.reasonCode, 'avatar-facade-projected'),
    actionHint: stringOr(projection?.actionHint, 'open_avatar_through_admitted_facade'),
    source: stringOr(projection?.source, 'sdk'),
    message: stringOr(projection?.message, 'Avatar facade projection is available.'),
    ...identity,
    configurationRef,
    launchAvailable: projection?.launchAvailable === true,
    manageAvailable: projection?.manageAvailable === true,
    launchHandoff: null,
  };
}

function normalizeAvatarPresenceError(
  error: unknown,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuAvatarPresenceStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return avatarUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-avatar-facade-projection-unavailable'),
    actionHint: stringOr(record.actionHint, 'check_avatar_facade_projection'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Avatar facade projection is unavailable.',
    ...identity,
  });
}

function avatarUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuAvatarPresenceStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    configurationRef: null,
    launchAvailable: false,
    manageAvailable: false,
    launchHandoff: null,
  };
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | null {
  if (!localAgent.ready) {
    return null;
  }
  const ownerUserId = stringOr(localAgent.ownerUserId, '');
  const runtimeSourceRef = stringOr(localAgent.runtimeSourceRef, '');
  const localAgentRef = stringOr(localAgent.localAgentRef, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
