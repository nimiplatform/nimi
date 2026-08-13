import type {
  NimiLocalAppAgentAutonomyProjection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationIntent,
  NimiLocalAppAgentPresentationProfile,
  NimiLocalAppAgentPresentationProjection,
  NimiLocalAppTimestamp,
} from '@nimiplatform/sdk/app';
import type {
  NimiRuntimeAgentPresentationProfileProjection,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  createAgentCenterShellAppearanceAdapter,
  createFirstPartyAgentCenterSession,
  type AgentCenterAutonomyMutationInput,
  type AgentCenterAutonomyProjection,
  type AgentCenterOpaqueHandle,
  type AgentCenterPresentationAssetMaterial,
  type AgentCenterRuntimePresentationProfilePatch,
  type AgentCenterRuntimePresentationProfileSurface,
  type AgentCenterSession,
  type AgentCenterSharedAIConfigModule,
  type AgentCenterSharedAIConfigProjection,
} from '@nimiplatform/kit/features/agent-center';

import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';
import type { ZhiyuAuthorizedAgentCenterIdentity } from '../shell/agent/agent-center-handle.js';

const PRESENTATION_BACKENDS = new Set(['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video']);
const AUTONOMY_MODES = new Set(['off', 'low', 'medium', 'high']);
const MAX_DATE_MILLIS = 8_640_000_000_000_000n;

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r008
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r009
export function createZhiyuProductionAgentCenterSession(
  agentHandle: AgentCenterOpaqueHandle | null,
  identityInput: ZhiyuAuthorizedAgentCenterIdentity | null,
): AgentCenterSession | null {
  const handle = projectAgentHandle(agentHandle);
  const identity = projectIdentity(identityInput);
  if (!handle || !identity) return null;

  const configure = getZhiyuLocalAppClient().agentConfigure;
  const presentation = createPresentationSurface(configure, handle, identity);
  const appearance = createAgentCenterShellAppearanceAdapter({
    identity,
    accountId: identity.ownerUserId,
    runtimePresentation: presentation.surface,
    shell: null,
    avatarPreview: null,
    loadPresentation: presentation.load,
  });

  return createFirstPartyAgentCenterSession({
    identity,
    sharedAIConfig: createSharedAIConfigModule(configure),
    autonomy: createAutonomyAdapter(configure, handle, identity),
    appearance,
  });
}

function createSharedAIConfigModule(
  configure: NimiLocalAppAgentConfigureClient,
): AgentCenterSharedAIConfigModule {
  const module: AgentCenterSharedAIConfigModule = {
    async get(input) {
      assertExactInputKeys(input, ['subjectUserId'], 'shared AIConfig get');
      return projectSharedAIConfig(await configure.sharedAIConfig.get());
    },
    async overwrite(input) {
      assertExactInputKeys(
        input,
        ['subjectUserId', 'capabilities', 'displayProvenance'],
        'shared AIConfig overwrite',
        ['subjectUserId', 'displayProvenance'],
      );
      return projectSharedAIConfig(
        await configure.sharedAIConfig.overwrite(input.capabilities),
      );
    },
  };
  return Object.freeze(module);
}

function projectSharedAIConfig(
  aiConfig: AgentCenterSharedAIConfigProjection['aiConfig'],
): AgentCenterSharedAIConfigProjection {
  const intents = aiConfig.capabilities.map((intent) => {
    const route = intent.route.oneofKind;
    if (route !== 'local' && route !== 'cloud') {
      throw new Error(`Shared LocalAgent AIConfig capability ${intent.capabilityContract} has no Local or Cloud intent.`);
    }
    return Object.freeze({
      capability: intent.capabilityContract,
      route,
      requiredFeatures: Object.freeze([...intent.requiredFeatures]),
    });
  });
  return Object.freeze({
    aiConfig,
    capabilities: Object.freeze(intents.map((intent) => intent.capability)),
    intents: Object.freeze(intents),
  });
}

function createAutonomyAdapter(
  configure: NimiLocalAppAgentConfigureClient,
  agentHandle: NimiLocalAppAgentHandle,
  expectedIdentity: ZhiyuAuthorizedAgentCenterIdentity,
): {
  readonly load: (identity: RuntimeLocalAgentIdentityInput) => Promise<AgentCenterAutonomyProjection>;
  readonly update: (
    identity: RuntimeLocalAgentIdentityInput,
    mutation: AgentCenterAutonomyMutationInput,
  ) => Promise<AgentCenterAutonomyProjection>;
} {
  return Object.freeze({
    async load(identity) {
      assertIdentity(identity, expectedIdentity);
      return projectAutonomy(await configure.autonomy.snapshot({ agentHandle }));
    },
    async update(identity, mutation) {
      assertIdentity(identity, expectedIdentity);
      const mode = exactText(mutation.mode);
      if (!mode || !AUTONOMY_MODES.has(mode)) {
        throw new Error('Zhiyu Agent Center autonomy mode is invalid.');
      }
      const projection = await configure.autonomy.update({
        agentHandle,
        expectedAutonomyRevision: mutation.expectedRevision,
        intent: {
          ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
          config: {
            mode: mode as 'off' | 'low' | 'medium' | 'high',
            dailyTokenBudget: nonNegativeInteger(mutation.dailyTokenBudget, 'dailyTokenBudget'),
            maxTokensPerHook: nonNegativeInteger(mutation.maxTokensPerHook, 'maxTokensPerHook'),
          },
        },
      });
      return projectAutonomy(projection);
    },
  });
}

function projectAutonomy(
  projection: NimiLocalAppAgentAutonomyProjection,
): AgentCenterAutonomyProjection {
  return Object.freeze({
    revision: projection.autonomyRevision,
    mode: projection.config?.mode ?? null,
    enabled: projection.enabled,
    budgetExhausted: projection.budgetExhausted,
    usedTokensInWindow: projection.usedTokensInWindow,
    dailyTokenBudget: projection.config?.dailyTokenBudget ?? null,
    maxTokensPerHook: projection.config?.maxTokensPerHook ?? null,
    windowStartedAt: timestampToIso(projection.windowStartedAt),
    suspendedUntil: timestampToIso(projection.suspendedUntil),
  });
}

function createPresentationSurface(
  configure: NimiLocalAppAgentConfigureClient,
  agentHandle: NimiLocalAppAgentHandle,
  expectedIdentity: ZhiyuAuthorizedAgentCenterIdentity,
): {
  readonly surface: AgentCenterRuntimePresentationProfileSurface;
  readonly load: () => Promise<{
    readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
    readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
    readonly committedRevision: string;
  }>;
} {
  let current: NimiLocalAppAgentPresentationProjection | null = null;

  const load = async () => {
    current = await configure.presentation.snapshot({ agentHandle });
    return projectPresentation(current);
  };

  const commit = async (
    identity: RuntimeLocalAgentIdentityInput,
    patch: AgentCenterRuntimePresentationProfilePatch | null,
    expectedRevision: string,
    importedAssets: readonly AgentCenterPresentationAssetMaterial[] = [],
  ) => {
    assertIdentity(identity, expectedIdentity);
    if (!patch) {
      throw new Error('Zhiyu Local App presentation does not admit a clear-profile commit.');
    }
    const snapshot = current ?? await configure.presentation.snapshot({ agentHandle });
    current = await configure.presentation.commit({
      agentHandle,
      expectedPresentationRevision: expectedRevision,
      intent: presentationIntent(snapshot.profile, patch),
      importedAssets,
    });
    return projectPresentation(current);
  };

  return Object.freeze({
    load,
    surface: Object.freeze({
      setPresentationProfile: commit,
      patchPresentationProfile: commit,
    }),
  });
}

function projectPresentation(projection: NimiLocalAppAgentPresentationProjection): {
  readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly committedRevision: string;
} {
  return Object.freeze({
    profile: projectPresentationProfile(projection.profile),
    previousProfile: projectPresentationProfile(projection.previousProfile),
    committedRevision: projection.presentationRevision,
  });
}

function projectPresentationProfile(
  profile: NimiLocalAppAgentPresentationProfile | null,
): NimiRuntimeAgentPresentationProfileProjection | null {
  if (!profile) return null;
  return Object.freeze({
    backendKind: profile.backendKind,
    avatarAssetRef: profile.avatarAssetRef || null,
    expressionProfileRef: profile.expressionProfileRef || null,
    idlePreset: profile.idlePreset || null,
    interactionPolicyRef: profile.interactionPolicyRef || null,
    defaultVoiceReference: profile.defaultVoiceReference || null,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetRef: profile.backgroundAssetRef || null,
  });
}

function presentationIntent(
  current: NimiLocalAppAgentPresentationProfile | null,
  patch: AgentCenterRuntimePresentationProfilePatch,
): NimiLocalAppAgentPresentationIntent {
  const backendKind = patch.backendKind === null
    ? null
    : exactText(patch.backendKind) || current?.backendKind || null;
  if (!backendKind || !PRESENTATION_BACKENDS.has(backendKind)) {
    throw new Error('Zhiyu Agent Center presentation backend is unavailable.');
  }
  return Object.freeze({
    backendKind: backendKind as NimiLocalAppAgentPresentationIntent['backendKind'],
    avatarAssetRef: patchedText(patch.avatarAssetRef, current?.avatarAssetRef),
    expressionProfileRef: patchedText(patch.expressionProfileRef, current?.expressionProfileRef),
    idlePreset: patchedText(patch.idlePreset, current?.idlePreset),
    interactionPolicyRef: patchedText(patch.interactionPolicyRef, current?.interactionPolicyRef),
    defaultVoiceReference: patchedText(patch.defaultVoiceReference, current?.defaultVoiceReference),
    avatarAutoplay: patch.avatarAutoplay ?? current?.avatarAutoplay ?? false,
    backgroundAssetRef: patchedText(patch.backgroundAssetRef, current?.backgroundAssetRef),
  });
}

function patchedText(value: string | null | undefined, fallback: string | undefined): string {
  if (value === null) return '';
  if (value === undefined) return fallback ?? '';
  if (value.trim() !== value) throw new Error('Zhiyu Agent Center presentation text is invalid.');
  return value;
}

function timestampToIso(value: NimiLocalAppTimestamp | undefined): string | null {
  if (!value) return null;
  const millis = (BigInt(value.seconds) * 1_000n) + BigInt(Math.floor(value.nanos / 1_000_000));
  if (millis < -MAX_DATE_MILLIS || millis > MAX_DATE_MILLIS) {
    throw new Error('Zhiyu Agent Center autonomy timestamp is outside the supported range.');
  }
  return new Date(Number(millis)).toISOString();
}

function projectIdentity(
  input: ZhiyuAuthorizedAgentCenterIdentity | null,
): ZhiyuAuthorizedAgentCenterIdentity | null {
  if (!input) return null;
  const ownerUserId = exactText(input.ownerUserId);
  const runtimeSourceRef = exactText(input.runtimeSourceRef);
  const localAgentRef = exactText(input.localAgentRef);
  return ownerUserId && runtimeSourceRef && localAgentRef
    ? Object.freeze({ ownerUserId, runtimeSourceRef, localAgentRef })
    : null;
}

function projectAgentHandle(value: AgentCenterOpaqueHandle | null): NimiLocalAppAgentHandle | null {
  const handle = exactText(value);
  return /^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)
    ? handle as NimiLocalAppAgentHandle
    : null;
}

function assertIdentity(
  input: RuntimeLocalAgentIdentityInput,
  expected: ZhiyuAuthorizedAgentCenterIdentity,
): void {
  if (input.ownerUserId !== expected.ownerUserId
    || input.runtimeSourceRef !== expected.runtimeSourceRef
    || input.localAgentRef !== expected.localAgentRef) {
    throw new Error('Zhiyu Agent Center identity changed during the operation.');
  }
}

function assertExactInputKeys(
  input: object,
  allowed: readonly string[],
  operation: string,
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(input);
  const required = allowed.filter((key) => !optional.includes(key));
  if (keys.some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(input, key))) {
    throw new Error(`Zhiyu Agent Center ${operation} input is invalid.`);
  }
}

function nonNegativeInteger(value: string | number, field: string): number {
  const parsed = typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? Number(value)
    : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Zhiyu Agent Center ${field} is invalid.`);
  }
  return parsed;
}

function exactText(value: unknown): string {
  return typeof value === 'string' && value.trim() === value ? value : '';
}
