import { sealAgentCenterPermissionedSdkSurface } from '@nimiplatform/kit/features/agent-center';
import { createNimiRuntimeAgentModelSettingsScopeRef } from '@nimiplatform/sdk/runtime';
import type {
  AgentCenterAppearanceProjection,
  AgentCenterAutonomyProjection,
  AgentCenterPermissionedPresentationIntent,
  AgentCenterPermissionedSdkSurface,
  AgentCenterProductAction,
  AgentCenterStateInput,
  AgentCenterTransportActionPosture,
  AgentCenterTransportActionProjection,
  AgentCenterTransportActionReason,
} from '@nimiplatform/kit/features/agent-center';
import type {
  NimiAgentCapabilityGroup,
  NimiAgentCapabilityPosture,
  NimiAgentCapabilityPostureEntry,
  NimiAgentCapabilityPostureReason,
  NimiLocalAppAgentAutonomyConfig,
  NimiLocalAppAgentAutonomyProjection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentConfigurationProjection,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationIntent,
  NimiLocalAppAgentPresentationProjection,
  NimiLocalAppAgentReadinessProjection,
  NimiLocalAppClient,
  NimiLocalAppTimestamp,
} from '@nimiplatform/sdk/app';

const ACTIONS: readonly AgentCenterProductAction[] = [
  'readModelSettings', 'updateModelSettings', 'readAutonomy', 'updateAutonomy',
  'readMemorySummary', 'replaceAppearance', 'restorePreviousAppearance',
  'requestPermission', 'openPermissionSettings',
];

const ACTION_GROUP: Readonly<Record<AgentCenterProductAction, NimiAgentCapabilityGroup>> = {
  readModelSettings: 'configure', updateModelSettings: 'configure',
  readAutonomy: 'configure', updateAutonomy: 'configure',
  readMemorySummary: 'memory', replaceAppearance: 'configure', restorePreviousAppearance: 'configure',
  requestPermission: 'configure', openPermissionSettings: 'configure',
};

const REASONS: Readonly<Record<Exclude<NimiAgentCapabilityPostureReason, null>, AgentCenterTransportActionReason>> = {
  reserved_not_admitted: 'reserved_not_admitted',
  unknown: 'unknown',
  not_granted: 'not_granted',
  request_pending: 'request_pending',
  grant_denied: 'grant_denied',
  grant_revoked: 'grant_revoked',
};

export const ZHIYU_AGENTS_CONFIGURE_REASON = '管理此 Agent 的模型、行为、自主性、语音引用和外观设置。';

export interface CreateZhiyuAgentCenterPermissionedSurfaceInput {
  readonly agentConfigure: NimiLocalAppAgentConfigureClient;
  readonly permissions: Pick<
    NimiLocalAppClient['permissions'],
    'request' | 'subscribeAgentCapabilityPosture'
  >;
  readonly loadPosture: () => Promise<NimiAgentCapabilityPosture>;
}

function actionEntry(
  entry: NimiAgentCapabilityPostureEntry,
  action: AgentCenterProductAction,
): AgentCenterTransportActionPosture {
  if (action === 'requestPermission') {
    return entry.reason === 'not_granted' || entry.reason === 'grant_denied' || entry.reason === 'grant_revoked'
      ? { state: 'available', reason: null }
      : { state: 'unavailable', reason: entry.reason ? REASONS[entry.reason] : 'unknown' };
  }
  if (action === 'openPermissionSettings') {
    return { state: 'unavailable', reason: entry.reason ? REASONS[entry.reason] : 'unknown' };
  }
  return entry.posture === 'granted'
    ? { state: 'available', reason: null }
    : { state: 'unavailable', reason: entry.reason ? REASONS[entry.reason] : 'unknown' };
}

export function mapZhiyuAgentCenterActionPosture(
  input: NimiAgentCapabilityPosture,
): AgentCenterTransportActionProjection {
  return Object.fromEntries(ACTIONS.map((action) => [
    action,
    actionEntry(input[ACTION_GROUP[action]], action),
  ])) as AgentCenterTransportActionProjection;
}

function allActionsUnavailable(
  reason: AgentCenterTransportActionReason,
): AgentCenterTransportActionProjection {
  return Object.fromEntries(ACTIONS.map((action) => [action, {
    state: 'unavailable', reason,
  }])) as AgentCenterTransportActionProjection;
}

export async function loadZhiyuAgentCenterActionPosture(
  loadPosture: () => Promise<NimiAgentCapabilityPosture>,
): Promise<AgentCenterTransportActionProjection> {
  try {
    return mapZhiyuAgentCenterActionPosture(await loadPosture());
  } catch {
    return allActionsUnavailable('runtime_offline');
  }
}

export function createZhiyuAgentCenterPermissionedSdkSurface(
  input: CreateZhiyuAgentCenterPermissionedSurfaceInput,
): AgentCenterPermissionedSdkSurface {
  const actionPosture = () => loadZhiyuAgentCenterActionPosture(input.loadPosture);
  const readAggregate = async (
    handle: NimiLocalAppAgentHandle,
    replacements: Partial<ConfigureSnapshots> = {},
  ): Promise<AgentCenterStateInput> => {
    const posture = await actionPosture();
    if (posture.readModelSettings.state !== 'available') return {};
    return composeAgentCenterProjection(handle, await loadConfigureSnapshots(input.agentConfigure, handle, replacements));
  };
  return sealAgentCenterPermissionedSdkSurface({
    actionPosture: async () => actionPosture(),
    subscribeActionPosture(_handle, listener) {
      return input.permissions.subscribeAgentCapabilityPosture(
        (posture) => listener(mapZhiyuAgentCenterActionPosture(posture)),
        () => listener(allActionsUnavailable('runtime_offline')),
      );
    },
    read: (handle) => readAggregate(asSdkHandle(handle)),
    async updateConfiguration(handle, mutation) {
      const agentHandle = asSdkHandle(handle);
      const result = await input.agentConfigure.updateConfiguration({
        agentHandle,
        expectedConfigurationRevision: mutation.expectedConfigurationRevision,
        routeIntents: mutation.routeIntents,
      });
      if (result.outcome === 'conflict') throw result.conflict;
      return readAggregate(agentHandle, { configuration: result.projection });
    },
    async updateAutonomy(handle, mutation) {
      const agentHandle = asSdkHandle(handle);
      const current = await input.agentConfigure.autonomySnapshot({ agentHandle });
      const config = autonomyMutationConfig(current, mutation);
      const result = await input.agentConfigure.updateAutonomy({
        agentHandle,
        expectedAutonomyRevision: mutation.expectedRevision,
        intent: {
          ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
          ...(config ? { config } : {}),
        },
      });
      if (result.outcome === 'conflict') throw result.conflict;
      return readAggregate(agentHandle, { autonomy: result.projection });
    },
    async replaceAppearance(handle, commit) {
      const agentHandle = asSdkHandle(handle);
      const current = await input.agentConfigure.presentationSnapshot({ agentHandle });
      const result = await input.agentConfigure.commitPresentation({
        agentHandle,
        expectedPresentationRevision: commit.expectedRevision,
        intent: presentationIntent(current, commit.intent),
        importedAssets: commit.importedAssets,
      });
      if (result.outcome === 'conflict') throw result.conflict;
      if (result.outcome === 'validation-failed') throw result.failure;
      return readAggregate(agentHandle, { presentation: result.projection });
    },
    async restorePreviousAppearance(handle) {
      const agentHandle = asSdkHandle(handle);
      const current = await input.agentConfigure.presentationSnapshot({ agentHandle });
      if (!current.previousProfile) throw new Error('No previous committed appearance is available to restore.');
      const result = await input.agentConfigure.commitPresentation({
        agentHandle,
        expectedPresentationRevision: current.presentationRevision,
        intent: presentationIntent(current, {
          backendKind: current.previousProfile.backendKind,
          avatarAssetReference: current.previousProfile.avatarAssetRef,
          defaultVoiceReference: current.previousProfile.defaultVoiceReference,
          avatarAutoplay: current.previousProfile.avatarAutoplay,
          backgroundAssetReference: current.previousProfile.backgroundAssetRef,
        }),
        importedAssets: [],
      });
      if (result.outcome === 'conflict') throw result.conflict;
      if (result.outcome === 'validation-failed') throw result.failure;
      return readAggregate(agentHandle, { presentation: result.projection });
    },
    async requestPermission() {
      await input.permissions.request({
        permissionId: 'agents.configure',
        reason: ZHIYU_AGENTS_CONFIGURE_REASON,
      });
    },
  });
}

type ConfigureSnapshots = {
  readonly configuration: NimiLocalAppAgentConfigurationProjection;
  readonly readiness: NimiLocalAppAgentReadinessProjection;
  readonly autonomy: NimiLocalAppAgentAutonomyProjection;
  readonly presentation: NimiLocalAppAgentPresentationProjection;
};

async function loadConfigureSnapshots(
  client: NimiLocalAppAgentConfigureClient,
  agentHandle: NimiLocalAppAgentHandle,
  replacements: Partial<ConfigureSnapshots>,
): Promise<ConfigureSnapshots> {
  const [configuration, readiness, autonomy, presentation] = await Promise.all([
    replacements.configuration || client.configurationSnapshot({ agentHandle }),
    replacements.readiness || client.readinessSnapshot({ agentHandle }),
    replacements.autonomy || client.autonomySnapshot({ agentHandle }),
    replacements.presentation || client.presentationSnapshot({ agentHandle }),
  ]);
  return { configuration, readiness, autonomy, presentation };
}

function composeAgentCenterProjection(
  handle: NimiLocalAppAgentHandle,
  snapshots: ConfigureSnapshots,
): AgentCenterStateInput {
  const revision = decimalRevision(snapshots.configuration.configurationRevision);
  const readinessRevision = decimalRevision(snapshots.readiness.configurationRevision);
  if (!revision || readinessRevision !== revision) {
    throw new Error('Agent Center model-settings projection revisions do not match.');
  }
  return {
    modelSettings: {
      scopeRef: createNimiRuntimeAgentModelSettingsScopeRef(String(handle)),
      capabilities: snapshots.configuration.capabilities,
      routeIntents: snapshots.configuration.routeIntents,
      readiness: snapshots.readiness.capabilities.map((capability) => ({
        capability: capability.capability,
        state: readinessState(capability.state),
        reason: capability.reason,
        observedAt: timestampIso(capability.observedAt),
      })),
      configurationRevision: revision,
    },
    autonomy: autonomyProjection(snapshots.autonomy),
    appearance: appearanceProjection(snapshots.presentation),
  };
}

function readinessState(value: string): 'ready' | 'blocked' | 'unavailable' | 'failed' {
  if (value === 'ready' || value === 'blocked' || value === 'failed') return value;
  return 'unavailable';
}

function autonomyProjection(input: NimiLocalAppAgentAutonomyProjection): AgentCenterAutonomyProjection {
  return {
    revision: input.autonomyRevision,
    enabled: input.enabled,
    mode: input.config?.mode ?? null,
    usedTokensInWindow: input.usedTokensInWindow,
    dailyTokenBudget: input.config?.dailyTokenBudget ?? null,
    maxTokensPerHook: input.config?.maxTokensPerHook ?? null,
    windowStartedAt: timestampIso(input.windowStartedAt),
    suspendedUntil: timestampIso(input.suspendedUntil),
    budgetExhausted: input.budgetExhausted,
  };
}

function appearanceProjection(input: NimiLocalAppAgentPresentationProjection): AgentCenterAppearanceProjection {
  const profile = input.profile;
  const avatarAssetRef = profile?.avatarAssetRef || null;
  return {
    status: avatarAssetRef ? 'ready' : 'not_configured',
    presentationRevision: input.presentationRevision,
    backendKind: profile?.backendKind || null,
    avatarAssetRef,
    backgroundRef: profile?.backgroundAssetRef || null,
    defaultVoiceReference: input.defaultVoiceReference || profile?.defaultVoiceReference || null,
    avatarAutoplay: profile?.avatarAutoplay ?? false,
    disabledReasonCode: avatarAssetRef ? null : 'avatar-not-configured',
    disabledReason: avatarAssetRef ? null : 'Avatar asset is not configured.',
  };
}

function autonomyMutationConfig(
  current: NimiLocalAppAgentAutonomyProjection,
  mutation: Parameters<AgentCenterPermissionedSdkSurface['updateAutonomy']>[1],
): NimiLocalAppAgentAutonomyConfig | null {
  const base = current.config;
  if (!base && (mutation.dailyTokenBudget === undefined || mutation.maxTokensPerHook === undefined || mutation.mode === undefined)) {
    throw new Error('Agent Center autonomy mutation lacks an SDK configuration source.');
  }
  return {
    dailyTokenBudget: Number(mutation.dailyTokenBudget ?? base!.dailyTokenBudget),
    maxTokensPerHook: Number(mutation.maxTokensPerHook ?? base!.maxTokensPerHook),
    mode: (mutation.mode ?? base!.mode) as NimiLocalAppAgentAutonomyConfig['mode'],
    ...(base?.minHookInterval ? { minHookInterval: base.minHookInterval } : {}),
    ...(base?.suspendUntil ? { suspendUntil: base.suspendUntil } : {}),
  };
}

function presentationIntent(
  current: NimiLocalAppAgentPresentationProjection,
  mutation: AgentCenterPermissionedPresentationIntent,
): NimiLocalAppAgentPresentationIntent {
  const profile = current.profile;
  const backendKind = mutation.backendKind ?? profile?.backendKind;
  if (!['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'].includes(backendKind || '')) {
    throw new Error('Agent Center presentation backend has no SDK source.');
  }
  return {
    backendKind: backendKind as NimiLocalAppAgentPresentationIntent['backendKind'],
    avatarAssetRef: mutation.avatarAssetReference ?? profile?.avatarAssetRef ?? '',
    expressionProfileRef: profile?.expressionProfileRef ?? '',
    idlePreset: profile?.idlePreset ?? '',
    interactionPolicyRef: profile?.interactionPolicyRef ?? '',
    defaultVoiceReference: mutation.defaultVoiceReference ?? profile?.defaultVoiceReference ?? '',
    avatarAutoplay: mutation.avatarAutoplay ?? profile?.avatarAutoplay ?? false,
    backgroundAssetRef: mutation.backgroundAssetReference ?? profile?.backgroundAssetRef ?? '',
  };
}

function decimalRevision(value: string): string | null {
  return /^(?:0|[1-9]\d*)$/u.test(value) ? value : null;
}

function timestampIso(value: NimiLocalAppTimestamp | undefined): string | null {
  if (!value) return null;
  try {
    const milliseconds = Number(BigInt(value.seconds) * 1_000n + BigInt(Math.floor(value.nanos / 1_000_000)));
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function asSdkHandle(value: string): NimiLocalAppAgentHandle {
  return value as NimiLocalAppAgentHandle;
}
