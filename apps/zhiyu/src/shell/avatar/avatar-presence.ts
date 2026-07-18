import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from '../agent/local-agent-discovery';

const APP_ID = 'nimi.zhiyu';
const RUNTIME_PRESENTATION_PROFILE_REF = 'runtime-agent-presentation-profile';
const UNSUPPORTED_AVATAR_FIELDS = [
  'configurationId',
  'displayName',
  'compatibilityTier',
  'readinessState',
  'liveInstanceBinding',
  'presentationHandoffState',
  'avatarDiagnosticCode',
  'assetManifestPath',
  'motionState',
  'expressionState',
] as const;

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

export interface ZhiyuRuntimePresentationProfileProjection {
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly defaultVoiceReference?: string | null;
}

export type ZhiyuRuntimePresentationProfileReader = (
  input: ZhiyuAvatarPresenceReadInput,
) => Promise<ZhiyuRuntimePresentationProfileProjection | null | undefined>;

export interface ZhiyuAvatarPresenceProbeOptions {
  readonly readAvatarPresence?: ZhiyuAvatarPresenceReader;
  readonly readPresentationProfile?: ZhiyuRuntimePresentationProfileReader;
  readonly hasRuntimeBridge?: () => Promise<boolean>;
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

  if (options.readAvatarPresence) {
    try {
      const projection = await options.readAvatarPresence(identity);
      return avatarAvailable(projection, identity);
    } catch (error) {
      return normalizeAvatarPresenceError(error, identity);
    }
  }

  const bridgeAvailable = options.hasRuntimeBridge
    ? await options.hasRuntimeBridge()
    : options.readPresentationProfile
      ? true
      : await hasRuntimeBridge();
  if (!bridgeAvailable) {
    return avatarUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
      ...identity,
    });
  }

  try {
    const reader = options.readPresentationProfile ?? readRuntimeAgentPresentationProfile;
    const projection = await reader(identity);
    return avatarPresenceFromPresentationProfile(projection, identity);
  } catch (error) {
    return normalizeAvatarPresenceError(error, identity);
  }
}

async function readRuntimeAgentPresentationProfile(
  input: ZhiyuAvatarPresenceReadInput,
): Promise<ZhiyuRuntimePresentationProfileProjection | null> {
  const {
    buildRuntimeAgentRequestContext,
    readNimiRuntimeAgentPresentationProfile,
  } = await import('@nimiplatform/sdk/runtime');
  const {
    withZhiyuRuntimeAgentBindingRequired,
  } = await import('../agent-chat/runtime-agent-binding');
  const { getZhiyuRuntime } = await import('../auth/runtime-platform');
  const runtime = getZhiyuRuntime();
  const context = buildRuntimeAgentRequestContext({
    runtimeAppId: APP_ID,
    subjectUserId: input.ownerUserId,
    ...input,
  });
  const response = await withZhiyuRuntimeAgentBindingRequired(['runtime.agent.read'], (callOptions) => runtime.agents.getAgent({
    context,
    agentId: input.localAgentRef,
  }, callOptions));
  return readNimiRuntimeAgentPresentationProfile(response.agent);
}

async function hasRuntimeBridge(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  const { hasElectronRuntime } = await import('@nimiplatform/kit/shell/renderer/bridge');
  return hasElectronRuntime();
}

function avatarPresenceFromPresentationProfile(
  profile: ZhiyuRuntimePresentationProfileProjection | null | undefined,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuAvatarPresenceStatus {
  if (!profile) {
    return avatarUnavailable({
      reasonCode: 'runtime-agent-presentation-profile-not-projected',
      actionHint: 'set_runtime_agent_presentation_profile',
      source: 'runtime',
      message: 'Runtime Agent presentation profile is not projected for this LocalAgent.',
      ...identity,
    });
  }
  const backendKind = avatarBackendKindOrNull(profile.backendKind);
  if (!backendKind || !stringOr(profile.avatarAssetRef, '')) {
    return avatarUnavailable({
      reasonCode: 'runtime-agent-presentation-profile-invalid',
      actionHint: 'check_runtime_agent_presentation_profile',
      source: 'runtime',
      message: 'Runtime Agent presentation profile is missing admitted Avatar presence fields.',
      ...identity,
    });
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: 'runtime-agent-presentation-profile-projected',
    actionHint: 'inspect_runtime_agent_presentation_profile',
    source: 'runtime',
    message: 'Runtime Agent presentation profile is projected through SDK Runtime Agent read.',
    ...identity,
    projectionRef: RUNTIME_PRESENTATION_PROFILE_REF,
    configurationRef: null,
    backendKind,
    visualReadiness: 'projected',
    voiceReadiness: stringOr(profile.defaultVoiceReference, '') ? 'projected' : 'not_projected',
    launchAvailable: true,
    manageAvailable: false,
    launchHandoff: null,
    unsupportedFields: [...UNSUPPORTED_AVATAR_FIELDS],
  };
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
    projectionRef: null,
    configurationRef,
    backendKind: null,
    visualReadiness: 'not_projected',
    voiceReadiness: 'not_projected',
    launchAvailable: projection?.launchAvailable === true,
    manageAvailable: projection?.manageAvailable === true,
    launchHandoff: null,
    unsupportedFields: [...UNSUPPORTED_AVATAR_FIELDS],
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
    projectionRef: null,
    configurationRef: null,
    backendKind: null,
    visualReadiness: 'not_projected',
    voiceReadiness: 'not_projected',
    launchAvailable: false,
    manageAvailable: false,
    launchHandoff: null,
    unsupportedFields: [...UNSUPPORTED_AVATAR_FIELDS],
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

function avatarBackendKindOrNull(value: unknown): ZhiyuAvatarPresenceStatus['backendKind'] {
  const normalized = stringOr(value, '');
  if (
    normalized === 'vrm'
    || normalized === 'live2d'
    || normalized === 'sprite2d'
    || normalized === 'canvas2d'
    || normalized === 'video'
  ) {
    return normalized;
  }
  return null;
}
