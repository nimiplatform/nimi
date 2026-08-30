import { createAppAgentCenterSession } from '../src/session.js';
import type {
  NimiAIConfigCloudConnectorOption,
  NimiAIConfigCloudTargetOption,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationProfile,
  NimiLocalAppAgentPresentationProjection,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterAutonomyProjection,
  AgentCenterAppManagerSnapshot,
  AgentCenterHostMechanics,
  AgentCenterMemoryProjection,
  AgentCenterResourcePackTargetController,
  AgentCenterResourcePackPlacementAdapter,
  AgentCenterSession,
  AgentCenterSharedAIConfigProjection,
  AgentCenterStateInput,
} from '../src/types.js';

export const TEST_AGENT_HANDLE = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;

export const TEST_LOCAL_AGENT_PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

function projectIntents(
  capabilities: AgentCenterSharedAIConfigProjection['aiConfig']['capabilities'],
): AgentCenterSharedAIConfigProjection['intents'] {
  return capabilities.map((intent) => ({
    capability: intent.capabilityContract,
    route: intent.route.oneofKind === 'local' ? 'local' : 'cloud',
    requiredFeatures: [...intent.requiredFeatures],
  }));
}

function defaultAIConfig(): AgentCenterSharedAIConfigProjection {
  return {
    aiConfig: {
      owner: {
        owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
      },
      capabilities: [],
    },
    revision: '1',
    intents: [],
  };
}

const EMPTY_MEMORY: AgentCenterMemoryProjection = {
  outcome: 'unconfigured',
  enabled: false,
  adoptionRequired: true,
  items: [],
  currentCount: 0,
  supersededCount: 0,
  forgottenCount: 0,
  nextPageToken: null,
};

const EMPTY_AUTONOMY: AgentCenterAutonomyProjection = {
  revision: '1',
  mode: 'off',
  enabled: false,
  budgetExhausted: false,
  usedTokensInWindow: 0,
  dailyTokenBudget: 0,
  maxTokensPerHook: 0,
  windowStartedAt: null,
  suspendedUntil: null,
};

type ManagerActionAvailability = AgentCenterAppManagerSnapshot['actionAvailability'];

export function testManagerActionAvailability(
  overrides: Partial<ManagerActionAvailability> = {},
): ManagerActionAvailability {
  const available = { state: 'available' as const, reason: null };
  return Object.freeze({
    getSharedAIConfig: available,
    overwriteSharedAIConfig: available,
    readAutonomy: available,
    updateAutonomy: available,
    inspectMemory: available,
    correctMemory: available,
    forgetMemory: available,
    switchMemory: available,
    deleteAllMemory: available,
    replaceAppearance: available,
    restorePreviousAppearance: {
      state: 'unavailable' as const,
      reason: 'previous-presentation-unavailable' as const,
    },
    ...overrides,
  });
}

function timestamp(value: string | null | undefined): { readonly seconds: string; readonly nanos: number } | undefined {
  if (!value) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return undefined;
  return {
    seconds: String(Math.floor(millis / 1_000)),
    nanos: Math.floor(millis % 1_000) * 1_000_000,
  };
}

function nextRevision(revision: string): string {
  return /^\d+$/u.test(revision) ? String(BigInt(revision) + 1n) : `next:${revision}`;
}

function presentationProfile(
  appearance: AgentCenterStateInput['appearance'],
  revision: string,
): NimiLocalAppAgentPresentationProfile | null {
  if (!appearance) return null;
  return {
    backendKind: appearance.backendKind as NimiLocalAppAgentPresentationProfile['backendKind'],
    avatarAssetRef: appearance.avatarAssetRef ?? '',
    expressionProfileRef: appearance.expressionProfileRef ?? '',
    idlePreset: appearance.idlePreset ?? '',
    interactionPolicyRef: appearance.interactionPolicyRef ?? '',
    defaultVoiceReference: appearance.defaultVoiceReference ?? '',
    avatarAutoplay: appearance.avatarAutoplay ?? false,
    backgroundAssetRef: appearance.backgroundRef ?? '',
    revision,
  };
}

function previousPresentationProfile(
  appearance: AgentCenterStateInput['appearance'],
  revision: string,
): NimiLocalAppAgentPresentationProfile | null {
  const previous = appearance?.previousSelection;
  if (!previous) return null;
  return {
    backendKind: previous.backendKind as NimiLocalAppAgentPresentationProfile['backendKind'],
    avatarAssetRef: previous.avatarAssetReference ?? '',
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: previous.defaultVoiceReference ?? '',
    avatarAutoplay: previous.avatarAutoplay ?? false,
    backgroundAssetRef: previous.backgroundAssetReference ?? '',
    revision,
  };
}

function managerSnapshot(
  projection: AgentCenterStateInput,
  memory: AgentCenterMemoryProjection,
  previousProfile: NimiLocalAppAgentPresentationProfile | null,
): Awaited<ReturnType<NimiLocalAppAgentConfigureClient['manager']['snapshot']>> {
  if (projection.manager) return projection.manager;
  const correctMemory = memory.adoptionRequired
    ? { state: 'unavailable' as const, reason: 'memory-adoption-required' as const }
    : !memory.enabled
      ? { state: 'unavailable' as const, reason: 'memory-disabled' as const }
      : { state: 'available' as const, reason: null };
  return {
    lifecycleStatus: 'active',
    executionState: 'idle',
    statusText: '',
    currentEmotion: '',
    source: null,
    context: null,
    actionAvailability: testManagerActionAvailability({
      correctMemory,
      restorePreviousAppearance: previousProfile
        ? { state: 'available', reason: null }
        : { state: 'unavailable', reason: 'previous-presentation-unavailable' },
    }),
  };
}

function fixtureHostMechanics(
  appearance: AgentCenterStateInput['appearance'],
  supplied: AgentCenterHostMechanics | null | undefined,
): AgentCenterHostMechanics | null {
  if (supplied) return supplied;
  if (!appearance?.renderState || !appearance.avatarAssetRef
    || (appearance.backendKind !== 'live2d' && appearance.backendKind !== 'vrm')) return null;
  const backendKind = appearance.backendKind;
  const avatarAssetRef = appearance.avatarAssetRef;
  return {
    async resolveCommittedPreview() {
      if (appearance.renderState === 'ready' && appearance.renderImageRef) {
        return {
          state: 'ready',
          tier: 'avatar_preview_service',
          backendKind,
          avatarAssetRef,
          previewMaterialRef: appearance.renderMaterialRef
            || `agent-center-preview-material:${avatarAssetRef}`,
          previewImageRef: appearance.renderImageRef,
          warnings: appearance.renderWarnings ?? [],
        };
      }
      return {
        state: appearance.renderState === 'failed' ? 'failed' : 'unavailable',
        tier: 'avatar_preview_service',
        backendKind,
        avatarAssetRef,
        previewMaterialRef: appearance.renderMaterialRef || null,
        previewImageRef: null,
        reason: appearance.renderFailureReason || 'Committed preview is unavailable.',
        warnings: appearance.renderWarnings ?? [],
      };
    },
  };
}

export async function sessionFor(
  projection: AgentCenterStateInput = {},
  hostMechanics?: AgentCenterHostMechanics | null,
  cloudOptions?: {
    readonly connectors: readonly NimiAIConfigCloudConnectorOption[];
    readonly targets: readonly NimiAIConfigCloudTargetOption[];
  },
  resourcePackTargetController?: AgentCenterResourcePackTargetController | null,
  resourcePackPlacement?: AgentCenterResourcePackPlacementAdapter | null,
): Promise<AgentCenterSession> {
  let sharedAIConfig = projection.sharedAIConfig === undefined
    ? defaultAIConfig()
    : projection.sharedAIConfig;
  let cognitionMemory = projection.cognitionMemory ?? EMPTY_MEMORY;
  let autonomy = projection.autonomy ?? EMPTY_AUTONOMY;
  let presentationRevision = projection.appearance?.presentationRevision ?? '0';
  let profile = presentationProfile(projection.appearance, presentationRevision);
  let previousProfile = previousPresentationProfile(projection.appearance, presentationRevision);
  let resourcePackSelection = projection.appearance?.resourcePackSelection ?? null;
  let resourcePackContent = new Uint8Array([7, 8, 9]);
  let resourcePackFileName = 'selected.nimipack';
  let resourcePackSha256 = 'c'.repeat(64);

  const client: NimiLocalAppAgentConfigureClient = {
    sharedAIConfig: {
      async get() {
        return {
          config: sharedAIConfig?.aiConfig ?? null,
          revision: sharedAIConfig?.revision ?? '0',
          effectiveSelections: projection.effectiveSelections ?? [],
          participation: projection.participation ?? TEST_LOCAL_AGENT_PARTICIPATION,
        };
      },
      async overwrite(input) {
        const capabilities = [...input.capabilities];
        const current = sharedAIConfig ?? defaultAIConfig();
        sharedAIConfig = {
          aiConfig: { ...current.aiConfig, capabilities },
          revision: nextRevision(current.revision),
          intents: projectIntents(capabilities),
        };
        return {
          outcome: 'committed',
          config: sharedAIConfig.aiConfig,
          revision: sharedAIConfig.revision,
          participation: projection.participation ?? TEST_LOCAL_AGENT_PARTICIPATION,
        };
      },
      async listOptions(input) {
        if (input.kind === 'voice-assets') {
          return { kind: input.kind, options: [], truncated: false };
        }
        if (input.kind === 'preset-voices') {
          return { kind: input.kind, options: [], truncated: false };
        }
        if (input.kind === 'cloud-connectors') {
          return { kind: input.kind, options: cloudOptions?.connectors ?? [], truncated: false };
        }
        if (input.kind === 'cloud-targets') {
          return {
            kind: input.kind,
            options: (cloudOptions?.targets ?? []).filter((target) => target.connectorRef === input.connectorRef),
            truncated: false,
          };
        }
        return {
          kind: 'local-loadouts',
          options: input.capabilityContract === 'text.generate' ? [{
            loadoutRef: 'loadout:text', label: 'Local text model', capabilityContract: 'text.generate',
            implementation: { implementationId: 'local.text', driverId: 'test', driverDialect: 'test/local/v1' },
			implementationSupportedFeatures: [], configuredFeatures: [], textBehaviors: [], state: 'ready', reasons: [],
          }] : [],
          truncated: false,
        };
      },
    },
    autonomy: {
      async snapshot() {
        const windowStartedAt = timestamp(autonomy.windowStartedAt);
        const suspendedUntil = timestamp(autonomy.suspendedUntil);
        return {
          enabled: autonomy.enabled ?? false,
          config: {
            mode: autonomy.mode ?? 'off',
            dailyTokenBudget: autonomy.dailyTokenBudget ?? 0,
            maxTokensPerHook: autonomy.maxTokensPerHook ?? 0,
          },
          usedTokensInWindow: autonomy.usedTokensInWindow ?? 0,
          ...(windowStartedAt ? { windowStartedAt } : {}),
          budgetExhausted: autonomy.budgetExhausted ?? false,
          ...(suspendedUntil ? { suspendedUntil } : {}),
          autonomyRevision: autonomy.revision ?? '0',
        };
      },
      async update(input) {
        autonomy = {
          ...autonomy,
          revision: nextRevision(input.expectedAutonomyRevision),
          enabled: input.intent.enabled ?? autonomy.enabled,
          mode: input.intent.config?.mode ?? autonomy.mode,
          dailyTokenBudget: input.intent.config?.dailyTokenBudget ?? autonomy.dailyTokenBudget,
          maxTokensPerHook: input.intent.config?.maxTokensPerHook ?? autonomy.maxTokensPerHook,
        };
        return this.snapshot({ agentHandle: input.agentHandle });
      },
    },
    presentation: {
      async snapshot(): Promise<NimiLocalAppAgentPresentationProjection> {
        return {
          profile,
          previousProfile,
          defaultVoiceReference: profile?.defaultVoiceReference ?? '',
          avatarAutoplay: profile?.avatarAutoplay ?? false,
          presentationRevision,
          resourcePackSelection,
        };
      },
      async readAsset(input) {
        if (resourcePackSelection?.assetRef === input.assetRef) {
          return {
            assetRef: input.assetRef,
            role: 'resource-pack',
            fileName: resourcePackFileName,
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from(resourcePackContent),
            sha256: resourcePackSha256,
          };
        }
        return {
          assetRef: input.assetRef,
          role: 'avatar',
          backendKind: profile?.backendKind ?? 'sprite2d',
          fileName: 'avatar.png',
          mediaType: 'image/png',
          content: new Uint8Array([1, 2, 3]),
          sha256: 'a'.repeat(64),
        };
      },
      async commit(input) {
        if ('selectImportedResourcePack' in input.intent) {
          const material = input.importedAssets[0];
          if (!material || material.role !== 'resource-pack') throw new Error('Resource Pack material required.');
          presentationRevision = nextRevision(input.expectedPresentationRevision);
          resourcePackContent = Uint8Array.from(material.content);
          resourcePackFileName = material.fileName;
          resourcePackSha256 = material.sha256;
          resourcePackSelection = {
            assetRef: `pack_${material.sha256.slice(0, 12)}`,
            targetId: 'zhiyu-experience-surface',
            targetVersion: 1,
          };
          return this.snapshot({ agentHandle: input.agentHandle });
        }
        if ('clearResourcePackSelection' in input.intent) {
          presentationRevision = nextRevision(input.expectedPresentationRevision);
          resourcePackSelection = null;
          return this.snapshot({ agentHandle: input.agentHandle });
        }
        previousProfile = profile;
        presentationRevision = nextRevision(input.expectedPresentationRevision);
        profile = {
          backendKind: input.intent.backendKind ?? profile?.backendKind ?? null,
          avatarAssetRef: input.intent.avatarAssetRef ?? profile?.avatarAssetRef ?? '',
          expressionProfileRef: input.intent.expressionProfileRef ?? profile?.expressionProfileRef ?? '',
          idlePreset: input.intent.idlePreset ?? profile?.idlePreset ?? '',
          interactionPolicyRef: input.intent.interactionPolicyRef ?? profile?.interactionPolicyRef ?? '',
          defaultVoiceReference: input.intent.defaultVoiceReference ?? profile?.defaultVoiceReference ?? '',
          avatarAutoplay: input.intent.avatarAutoplay ?? profile?.avatarAutoplay ?? false,
          backgroundAssetRef: input.intent.backgroundAssetRef ?? profile?.backgroundAssetRef ?? '',
          revision: presentationRevision,
        };
        return this.snapshot({ agentHandle: input.agentHandle });
      },
    },
    memory: {
      async inspect() { return cognitionMemory; },
      async correct(input) {
        cognitionMemory = {
          ...cognitionMemory,
          outcome: 'committed',
          items: cognitionMemory.items.map((item) => item.memoryId === input.memoryId
            ? { ...item, content: input.correctedContent, epistemicStatus: 'explicit' as const, updatedAt: new Date().toISOString() }
            : item),
        };
        return { outcome: 'committed', affectedMemoryIds: [input.memoryId], projection: cognitionMemory };
      },
      async forget(input) {
        const targets = new Set(input.memoryIds);
        const forgottenCount = cognitionMemory.forgottenCount
          + cognitionMemory.items.filter((item) => targets.has(item.memoryId)).length;
        cognitionMemory = {
          ...cognitionMemory,
          outcome: 'forgotten',
          items: cognitionMemory.items.filter((item) => !targets.has(item.memoryId)),
          currentCount: cognitionMemory.items.filter((item) => item.lifecycle === 'current' && !targets.has(item.memoryId)).length,
          forgottenCount,
        };
        return { outcome: 'forgotten', affectedMemoryIds: input.memoryIds, projection: cognitionMemory };
      },
      async setEnabled(input) {
        cognitionMemory = {
          ...cognitionMemory,
          outcome: input.enabled ? 'ready' : 'unconfigured',
          enabled: input.enabled,
          adoptionRequired: false,
        };
        return { outcome: 'committed', affectedMemoryIds: [], projection: cognitionMemory };
      },
      async deleteAll() {
        cognitionMemory = {
          ...cognitionMemory,
          outcome: 'deleted',
          items: [],
          currentCount: 0,
          supersededCount: 0,
          forgottenCount: 0,
          nextPageToken: null,
        };
        return { outcome: 'deleted', affectedMemoryIds: [], projection: cognitionMemory };
      },
    },
    manager: {
      async snapshot() {
        if (projection.runtimeError) {
          throw Object.assign(new Error(projection.runtimeError), {
            reasonCode: projection.runtimeError,
          });
        }
        return managerSnapshot(projection, cognitionMemory, previousProfile);
      },
    },
  };

  const session = createAppAgentCenterSession({
    handle: TEST_AGENT_HANDLE,
    client,
    hostMechanics: fixtureHostMechanics(projection.appearance, hostMechanics),
    resourcePackTargetController,
    resourcePackPlacement,
  });
  await session.refresh();
  return session;
}
