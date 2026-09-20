import {
  createAppAgentCenterSession,
  type AgentCenterHostMechanics,
  type AgentCenterResourcePackTargetController,
  type AgentCenterResourcePackTargetSnapshot,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import type {
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
} from '@nimiplatform/sdk/app';
import type { HeroDemoZhiyuPartner, HeroDemoZhiyuPreview } from '../content/landing-content.js';

/**
 * Mock Runtime behind the Zhiyu preview's Agent Center.
 *
 * The real Zhiyu shell binds the kit Agent Center to the SDK's
 * `agentConfigure` client of a protected Local App session. The preview
 * mounts the very same kit `AgentCenter` and `createAppAgentCenterSession`,
 * but the client here is an in-memory implementation seeded from the
 * landing content: every read and mutation (model intent, autonomy, memory,
 * appearance, Resource Pack) works against that state, and nothing leaves
 * the browser.
 */

type ConfigureClient = NimiLocalAppAgentConfigureClient;
type SharedAIConfigSnapshot = Awaited<ReturnType<ConfigureClient['sharedAIConfig']['get']>>;
type SharedAIConfig = NonNullable<SharedAIConfigSnapshot['config']>;
type AIConfigIntent = SharedAIConfig['capabilities'][number];
type EffectiveSelection = SharedAIConfigSnapshot['effectiveSelections'][number];
type OptionsResult = Awaited<ReturnType<ConfigureClient['sharedAIConfig']['listOptions']>>;
type LocalLoadoutOption = Extract<OptionsResult, { kind: 'local-loadouts' }>['options'][number];
type CloudConnectorOption = Extract<OptionsResult, { kind: 'cloud-connectors' }>['options'][number];
type CloudTargetOption = Extract<OptionsResult, { kind: 'cloud-targets' }>['options'][number];
type AutonomyProjection = Awaited<ReturnType<ConfigureClient['autonomy']['snapshot']>>;
type PresentationProjection = Awaited<ReturnType<ConfigureClient['presentation']['snapshot']>>;
type PresentationProfile = NonNullable<PresentationProjection['profile']>;
type PresentationAsset = Awaited<ReturnType<ConfigureClient['presentation']['readAsset']>>;
type MemoryProjection = Awaited<ReturnType<ConfigureClient['memory']['inspect']>>;
type ManagerSnapshot = Awaited<ReturnType<ConfigureClient['manager']['snapshot']>>;

const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const satisfies SharedAIConfigSnapshot['participation'];

const DEMO_CLOUD_CONNECTOR_REF = 'demo-cloud-connector';
const DEMO_IMPLEMENTATION = Object.freeze({
  implementationId: 'demo.local',
  driverId: 'demo',
  driverDialect: 'demo/local/v1',
});

/** Picker latency so the appearance and Resource Pack flows read as real host dialogs. */
const HOST_PICKER_DELAY_MS = 450;

export function demoZhiyuPartnerHandle(partnerId: string): NimiLocalAppAgentHandle {
  const slug = `demo_${partnerId.replace(/[^a-z0-9]/giu, '')}`;
  return `agent_ref_${slug.padEnd(43, '0').slice(0, 43)}` as NimiLocalAppAgentHandle;
}

/** Deterministic 64-hex digest stand-in for mock asset material. */
function demoSha256(seed: string): string {
  let hash = 0x811c9dc5;
  const out: string[] = [];
  for (let index = 0; index < 64; index += 1) {
    const code = seed.charCodeAt(index % seed.length) + index;
    hash = Math.imul(hash ^ code, 0x01000193) >>> 0;
    out.push((hash & 0xf).toString(16));
  }
  return out.join('');
}

function nextRevision(revision: string): string {
  return /^\d+$/u.test(revision) ? String(Number(revision) + 1) : `${revision}.1`;
}

function isoDaysAgo(now: number, daysAgo: number): string {
  return new Date(now - daysAgo * 86_400_000).toISOString();
}

function protoTimestamp(millis: number): { readonly seconds: string; readonly nanos: number } {
  return { seconds: String(Math.floor(millis / 1_000)), nanos: (millis % 1_000) * 1_000_000 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export class DemoZhiyuMockError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = 'DemoZhiyuMockError';
    this.reasonCode = reasonCode;
  }
}

/* ------------------------------------------------------------------------ */
/* Resource Pack target controller                                           */
/* ------------------------------------------------------------------------ */

export type DemoZhiyuResourcePackEffectiveSource = 'default' | 'preview' | 'selected' | 'last-safe';

export type DemoZhiyuResourcePackSnapshot = AgentCenterResourcePackTargetSnapshot & {
  readonly effectiveSource: DemoZhiyuResourcePackEffectiveSource;
  /** File name of the pack currently painting the conversation canvas. */
  readonly effectiveFileName: string | null;
};

type ResourcePackReview = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly expectedRevision: string;
  readonly fileName: string;
  readonly archiveBytes: Uint8Array;
};

const INITIAL_RESOURCE_PACK_SNAPSHOT: DemoZhiyuResourcePackSnapshot = Object.freeze({
  phase: 'default',
  reviewFileName: null,
  pendingTruth: null,
  effectiveResourceRef: null,
  mismatchReason: null,
  error: null,
  effectiveSource: 'default',
  effectiveFileName: null,
});

/**
 * Demo stand-in for Zhiyu's Resource Pack presentation controller. The real
 * one parses the `.nimipack` archive and paints scoped CSS onto the canvas;
 * this one only tracks the kit-driven phase machine so the Appearance card
 * and the canvas surface attribute move exactly like the app's.
 */
export class DemoZhiyuResourcePackController implements AgentCenterResourcePackTargetController {
  readonly #listeners = new Set<() => void>();
  readonly #fileNames: Map<string, string>;
  #snapshot: DemoZhiyuResourcePackSnapshot = INITIAL_RESOURCE_PACK_SNAPSHOT;
  #review: ResourcePackReview | null = null;
  #disposed = false;

  /**
   * The kit session disposes its controller together with itself, so one
   * controller lives per session; committed pack names are kept by the
   * partner's mock client and shared into every controller it spawns.
   */
  constructor(fileNames: Map<string, string> = new Map()) {
    this.#fileNames = fileNames;
  }

  getSnapshot = (): DemoZhiyuResourcePackSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  resetAgent(input: { readonly selectionRevision: string; readonly selectedResourceRef: string | null }): void {
    this.#review = null;
    if (input.selectedResourceRef) {
      this.#set({
        ...INITIAL_RESOURCE_PACK_SNAPSHOT,
        phase: 'render-pending',
        effectiveResourceRef: input.selectedResourceRef,
      });
      return;
    }
    this.#set(INITIAL_RESOURCE_PACK_SNAPSHOT);
  }

  async beginPreview(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly expectedRevision: string;
    readonly fileName: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<void> {
    this.#review = { ...input, archiveBytes: Uint8Array.from(input.archiveBytes) };
    this.#set({
      ...this.#snapshot,
      phase: 'preview',
      reviewFileName: input.fileName,
      pendingTruth: null,
      error: null,
      mismatchReason: null,
      effectiveSource: 'preview',
      effectiveFileName: input.fileName,
    });
  }

  cancelPreview(): void {
    this.#review = null;
    this.#restoreCommitted();
  }

  prepareApply(): { readonly agentHandle: NimiLocalAppAgentHandle; readonly expectedRevision: string; readonly archiveBytes: Uint8Array } {
    const review = this.#review;
    if (!review) throw new Error('No Resource Pack is under review.');
    this.#set({ ...this.#snapshot, phase: 'apply-in-flight' });
    return { agentHandle: review.agentHandle, expectedRevision: review.expectedRevision, archiveBytes: Uint8Array.from(review.archiveBytes) };
  }

  applyFailed(message: string): void {
    this.#review = null;
    this.#restoreCommitted(message);
  }

  mutationOutcomeUnknown(kind: 'apply' | 'clear', message: string): void {
    this.#set({
      ...this.#snapshot,
      pendingTruth: kind === 'apply' ? 'apply-outcome-unknown' : 'clear-outcome-unknown',
      error: message,
    });
  }

  applyCommitted(input: { readonly selectionRevision: string; readonly selectedResourceRef: string }): void {
    const fileName = this.#review?.fileName ?? this.#fileNames.get(input.selectedResourceRef) ?? null;
    if (fileName) this.#fileNames.set(input.selectedResourceRef, fileName);
    this.#review = null;
    this.#set({
      ...this.#snapshot,
      phase: 'render-pending',
      reviewFileName: null,
      pendingTruth: null,
      error: null,
      effectiveResourceRef: input.selectedResourceRef,
    });
  }

  async renderSelected(input: { readonly selectedResourceRef: string }): Promise<boolean> {
    if (this.#disposed) return false;
    this.#set({
      ...this.#snapshot,
      phase: 'selected',
      pendingTruth: null,
      error: null,
      mismatchReason: null,
      effectiveResourceRef: input.selectedResourceRef,
      effectiveSource: 'selected',
      effectiveFileName: this.#fileNames.get(input.selectedResourceRef) ?? null,
    });
    return true;
  }

  selectedRenderFailed(message: string): void {
    this.#set({
      ...this.#snapshot,
      phase: 'fallback',
      error: message,
      effectiveSource: 'last-safe',
    });
  }

  clearCommitted(): void {
    this.#review = null;
    this.#set(INITIAL_RESOURCE_PACK_SNAPSHOT);
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #restoreCommitted(error: string | null = null): void {
    const committed = this.#snapshot.effectiveResourceRef;
    this.#set({
      ...this.#snapshot,
      phase: committed ? 'selected' : 'default',
      reviewFileName: null,
      error,
      effectiveSource: committed ? 'selected' : 'default',
      effectiveFileName: committed ? this.#fileNames.get(committed) ?? null : null,
    });
  }

  #set(next: DemoZhiyuResourcePackSnapshot): void {
    this.#snapshot = Object.freeze(next);
    for (const listener of this.#listeners) listener();
  }
}

/* ------------------------------------------------------------------------ */
/* Mock configure client                                                     */
/* ------------------------------------------------------------------------ */

function localLoadout(capability: string, content: HeroDemoZhiyuPreview): LocalLoadoutOption {
  return {
    loadoutRef: `demo-loadout:${capability}`,
    label: content.demo.localModelLabels[capability] ?? capability,
    capabilityContract: capability,
    implementation: DEMO_IMPLEMENTATION,
    implementationSupportedFeatures: [],
    configuredFeatures: [],
    textBehaviors: [],
    state: 'ready',
    reasons: [],
  };
}

function cloudConnector(content: HeroDemoZhiyuPreview): CloudConnectorOption {
  return {
    connectorRef: DEMO_CLOUD_CONNECTOR_REF,
    label: content.demo.cloudConnectorLabel,
    provider: 'demo',
    state: 'ready',
    reasons: [],
  };
}

function cloudTarget(capability: string, content: HeroDemoZhiyuPreview): CloudTargetOption {
  return {
    connectorRef: DEMO_CLOUD_CONNECTOR_REF,
    label: content.demo.cloudTargetLabels[capability] ?? capability,
    capabilityContract: capability,
    implementation: DEMO_IMPLEMENTATION,
    providerModelTarget: { model: `demo-${capability}` },
    supportedFeatures: [],
    state: 'ready',
    reasons: [],
  };
}

function seedIntents(partner: HeroDemoZhiyuPartner): AIConfigIntent[] {
  return partner.aiConfig.map((entry) => ({
    capabilityContract: entry.capability,
    requiredFeatures: [],
    route: entry.route === 'local'
      ? { oneofKind: 'local', local: {} }
      : { oneofKind: 'cloud', cloud: { connectorRef: DEMO_CLOUD_CONNECTOR_REF } },
  }));
}

function effectiveSelections(intents: readonly AIConfigIntent[], content: HeroDemoZhiyuPreview): EffectiveSelection[] {
  return intents.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    state: 'ready',
    resource: intent.route.oneofKind === 'cloud'
      ? { oneofKind: 'cloud', cloud: { connector: cloudConnector(content), target: cloudTarget(intent.capabilityContract, content) } }
      : { oneofKind: 'local', local: localLoadout(intent.capabilityContract, content) },
    reasons: [],
  }));
}

function seedProfile(partner: HeroDemoZhiyuPartner, revision: string): PresentationProfile | null {
  const appearance = partner.appearance;
  if (!appearance.backendKind || !appearance.avatarAssetRef) return null;
  return {
    backendKind: appearance.backendKind,
    avatarAssetRef: appearance.avatarAssetRef,
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: appearance.defaultVoiceReference ?? '',
    avatarAutoplay: appearance.avatarAutoplay,
    backgroundAssetRef: appearance.backgroundAssetRef ?? '',
    revision,
  };
}

function seedMemory(partner: HeroDemoZhiyuPartner, now: number): MemoryProjection {
  const items = partner.memories.map((memory) => ({
    memoryId: memory.id,
    content: memory.content,
    epistemicStatus: memory.epistemicStatus,
    lifecycle: 'current' as const,
    occurredAt: isoDaysAgo(now, memory.daysAgo),
    updatedAt: isoDaysAgo(now, memory.daysAgo),
    sourceExplanation: memory.sourceExplanation,
  }));
  // A partner that has never had memory adopted mirrors the Runtime's
  // "unconfigured" state, so the kit Cognition section shows its adoption flow.
  const unconfigured = partner.manager.lifecycleStatus === 'initializing';
  return {
    outcome: unconfigured ? 'unconfigured' : 'ready',
    enabled: !unconfigured,
    adoptionRequired: unconfigured,
    items,
    currentCount: items.length,
    supersededCount: 0,
    forgottenCount: 0,
    nextPageToken: null,
  };
}

const COVERAGE_SECTIONS: ReadonlyArray<{
  section: NonNullable<ManagerSnapshot['source']>['coverageSections'][number]['section'];
  state: NonNullable<ManagerSnapshot['source']>['coverageSections'][number]['state'];
  required: number;
}> = [
  { section: 'identity', state: 'complete', required: 3 },
  { section: 'presentation', state: 'complete', required: 2 },
  { section: 'biography', state: 'complete', required: 4 },
  { section: 'psychology', state: 'complete', required: 2 },
  { section: 'knowledge', state: 'complete', required: 3 },
  { section: 'relationships', state: 'optional_omitted', required: 0 },
  { section: 'capabilities', state: 'complete', required: 1 },
  { section: 'interaction_profile', state: 'complete', required: 1 },
  { section: 'assets', state: 'optional_omitted', required: 0 },
  { section: 'authoring', state: 'complete', required: 1 },
  { section: 'world_core', state: 'complete', required: 2 },
  { section: 'bound_entity', state: 'not_applicable', required: 0 },
  { section: 'dependency_closure', state: 'complete', required: 1 },
];

const CONTEXT_LANES: ReadonlyArray<NonNullable<ManagerSnapshot['context']>['lanes'][number]['laneId']> = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
  'canonical_memory',
  'conversation_history',
  'capability_context',
  'current_user_turn',
  'cognition_source',
  'conversation_summary',
  'private_recall',
];

function managerSource(partner: HeroDemoZhiyuPartner, now: number): ManagerSnapshot['source'] {
  if (!partner.manager.sourceReady) {
    return {
      ready: false,
      state: 'not_materialized',
      reasonCode: 'source_not_materialized',
      capturedAt: null,
      coverageSections: [],
      lorebookReady: false,
      lorebookItemCount: 0,
      lorebookEstimatedTokens: '0',
    };
  }
  return {
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    capturedAt: protoTimestamp(now - 2 * 3_600_000),
    coverageSections: COVERAGE_SECTIONS.map((entry) => ({
      section: entry.section,
      state: entry.state,
      requiredCount: entry.required,
      resolvedCount: entry.state === 'complete' ? entry.required : 0,
      omittedCount: entry.state === 'optional_omitted' ? 1 : 0,
    })),
    lorebookReady: true,
    lorebookItemCount: partner.manager.lorebookItemCount,
    lorebookEstimatedTokens: String(partner.manager.lorebookItemCount * 180),
  };
}

function managerContext(partner: HeroDemoZhiyuPartner, memoryItemCount: number): ManagerSnapshot['context'] {
  const turns = partner.manager.transcriptTurnCount;
  if (!partner.manager.sourceReady || turns === 0) {
    return {
      ready: false,
      state: 'not_composed',
      reasonCode: 'context_not_composed',
      lanes: [],
      inputBudgetTokens: '0',
      usedTokens: '0',
      requiredInputTokens: '0',
      requiredContextWindowTokens: '0',
      truncation: [],
      transcriptTurnCount: 0,
      memoryItemCount: 0,
      mediaCount: 0,
      toolCount: 0,
      sourceAdapterStatus: 'unconfigured',
      sourceSelectionStatus: 'unconfigured',
      conversationSummaryStatus: 'absent',
      privateRecallCount: 0,
    };
  }
  const emptyLanes = new Set<string>([
    'relationship_context',
    ...(memoryItemCount === 0 ? ['canonical_memory', 'private_recall'] : []),
    ...(turns < 3 ? ['conversation_summary'] : []),
  ]);
  return {
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    lanes: CONTEXT_LANES.map((laneId, index) => ({
      laneId,
      state: emptyLanes.has(laneId) ? 'empty' : 'included',
      includedItemCount: emptyLanes.has(laneId) ? 0 : 1 + (index % 3),
      omittedItemCount: 0,
      truncatedItemCount: 0,
      allocatedTokens: String(1024 + index * 256),
      usedTokens: String(emptyLanes.has(laneId) ? 0 : 320 + index * 90),
    })),
    inputBudgetTokens: '32768',
    usedTokens: String(6_200 + turns * 900),
    requiredInputTokens: '8192',
    requiredContextWindowTokens: '16384',
    truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
    transcriptTurnCount: turns,
    memoryItemCount,
    mediaCount: 0,
    toolCount: 2,
    sourceAdapterStatus: 'ready',
    sourceSelectionStatus: 'ready',
    conversationSummaryStatus: turns >= 3 ? 'ready' : 'absent',
    privateRecallCount: memoryItemCount > 0 ? 1 : 0,
  };
}

export type DemoZhiyuAgentClient = {
  readonly handle: NimiLocalAppAgentHandle;
  readonly client: ConfigureClient;
  readonly hostMechanics: AgentCenterHostMechanics;
  /** Creates the per-session Resource Pack target controller for this partner. */
  createResourcePackController(): DemoZhiyuResourcePackController;
  /** Reflects the visitor's conversation activity into the manager snapshot. */
  noteConversationTurn(): void;
};

export function createDemoZhiyuAgentClient(
  partner: HeroDemoZhiyuPartner,
  content: HeroDemoZhiyuPreview,
  options: { readonly now?: () => number; readonly pickerDelayMs?: number } = {},
): DemoZhiyuAgentClient {
  const now = options.now ?? (() => Date.now());
  const pickerDelayMs = options.pickerDelayMs ?? HOST_PICKER_DELAY_MS;
  const handle = demoZhiyuPartnerHandle(partner.id);
  const resourcePackFileNames = new Map<string, string>();

  let aiConfigRevision = '1';
  let intents = seedIntents(partner);
  let autonomy = { ...partner.autonomy, revision: '1' };
  let presentationRevision = '1';
  let profile = seedProfile(partner, presentationRevision);
  let previousProfile: PresentationProfile | null = null;
  let resourcePackSelection: PresentationProjection['resourcePackSelection'] = null;
  let resourcePackMaterial: { fileName: string; content: Uint8Array; sha256: string } | null = null;
  let memory = seedMemory(partner, now());
  let extraTurns = 0;
  let assetSequence = 0;

  const presentationSnapshot = (): PresentationProjection => ({
    profile,
    previousProfile,
    defaultVoiceReference: profile?.defaultVoiceReference ?? '',
    avatarAutoplay: profile?.avatarAutoplay ?? false,
    presentationRevision,
    resourcePackSelection,
  });

  const memoryMutation = (outcome: MemoryProjection['outcome'], affected: readonly string[]) => ({
    outcome,
    affectedMemoryIds: affected,
    projection: memory,
  });

  const client: ConfigureClient = {
    sharedAIConfig: {
      async get() {
        return {
          config: {
            owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
            capabilities: intents.map((intent) => ({ ...intent })),
          },
          revision: aiConfigRevision,
          effectiveSelections: effectiveSelections(intents, content),
          participation: PARTICIPATION,
        };
      },
      async overwrite(input) {
        if (input.expectedRevision !== aiConfigRevision) {
          return {
            outcome: 'conflict',
            config: { capabilities: intents.map((intent) => ({ ...intent })) },
            revision: aiConfigRevision,
            reasonCode: 'AI_CONFIG_REVISION_CONFLICT',
            participation: PARTICIPATION,
          };
        }
        intents = input.capabilities.map((intent) => ({ ...intent, requiredFeatures: [...intent.requiredFeatures] }));
        aiConfigRevision = nextRevision(aiConfigRevision);
        return {
          outcome: 'committed',
          config: { capabilities: intents.map((intent) => ({ ...intent })) },
          revision: aiConfigRevision,
          participation: PARTICIPATION,
        };
      },
      async listOptions(query) {
        switch (query.kind) {
          case 'preset-voices':
            return {
              kind: 'preset-voices',
              options: content.demo.presetVoices.map((voice) => ({ ...voice, supportedLangs: ['zh-CN'] })),
              truncated: false,
            };
          case 'voice-assets':
            return { kind: 'voice-assets', options: [], truncated: false };
          case 'cloud-connectors':
            return { kind: 'cloud-connectors', options: [cloudConnector(content)], truncated: false };
          case 'cloud-targets':
            return {
              kind: 'cloud-targets',
              options: query.connectorRef === DEMO_CLOUD_CONNECTOR_REF ? [cloudTarget(query.capabilityContract, content)] : [],
              truncated: false,
            };
          case 'local-loadouts':
            return { kind: 'local-loadouts', options: [localLoadout(query.capabilityContract, content)], truncated: false };
        }
      },
    },
    autonomy: {
      async snapshot(): Promise<AutonomyProjection> {
        return {
          enabled: autonomy.enabled,
          config: {
            mode: autonomy.mode,
            dailyTokenBudget: autonomy.dailyTokenBudget,
            maxTokensPerHook: autonomy.maxTokensPerHook,
          },
          usedTokensInWindow: autonomy.usedTokensInWindow,
          windowStartedAt: protoTimestamp(now() - 5 * 3_600_000),
          budgetExhausted: autonomy.dailyTokenBudget > 0 && autonomy.usedTokensInWindow >= autonomy.dailyTokenBudget,
          autonomyRevision: autonomy.revision,
        };
      },
      async update(input) {
        if (input.expectedAutonomyRevision !== autonomy.revision) {
          throw new DemoZhiyuMockError('AUTONOMY_REVISION_CONFLICT', '主动陪伴设置已在别处更新，请刷新后再试。');
        }
        autonomy = {
          ...autonomy,
          revision: nextRevision(autonomy.revision),
          enabled: input.intent.enabled ?? autonomy.enabled,
          mode: input.intent.config?.mode ?? autonomy.mode,
          dailyTokenBudget: input.intent.config?.dailyTokenBudget ?? autonomy.dailyTokenBudget,
          maxTokensPerHook: input.intent.config?.maxTokensPerHook ?? autonomy.maxTokensPerHook,
        };
        return this.snapshot({ agentHandle: input.agentHandle });
      },
    },
    presentation: {
      async snapshot() {
        return presentationSnapshot();
      },
      async readAsset(input): Promise<PresentationAsset> {
        if (resourcePackSelection?.assetRef === input.assetRef && resourcePackMaterial) {
          return {
            assetRef: input.assetRef,
            role: 'resource-pack',
            fileName: resourcePackMaterial.fileName,
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from(resourcePackMaterial.content),
            sha256: resourcePackMaterial.sha256,
          };
        }
        return {
          assetRef: input.assetRef,
          role: 'avatar',
          backendKind: profile?.backendKind ?? 'live2d',
          fileName: content.demo.avatarFileNames[profile?.backendKind === 'vrm' ? 'vrm' : 'live2d'],
          mediaType: 'application/octet-stream',
          content: new TextEncoder().encode(input.assetRef),
          sha256: demoSha256(input.assetRef),
        };
      },
      async commit(input) {
        if (input.expectedPresentationRevision !== presentationRevision) {
          throw new DemoZhiyuMockError('PRESENTATION_REVISION_CONFLICT', '形象设置已在别处更新，请刷新后再试。');
        }
        if ('selectImportedResourcePack' in input.intent) {
          const material = input.importedAssets[0];
          if (!material || material.role !== 'resource-pack') {
            throw new DemoZhiyuMockError('RESOURCE_PACK_MATERIAL_REQUIRED', '需要 Resource Pack 文件。');
          }
          presentationRevision = nextRevision(presentationRevision);
          resourcePackMaterial = {
            fileName: material.fileName,
            content: Uint8Array.from(material.content),
            sha256: material.sha256,
          };
          resourcePackSelection = {
            assetRef: `pack_${material.sha256.slice(0, 12)}`,
            targetId: 'zhiyu-experience-surface',
            targetVersion: 1,
          };
          resourcePackFileNames.set(resourcePackSelection.assetRef, material.fileName);
          return presentationSnapshot();
        }
        if ('clearResourcePackSelection' in input.intent) {
          presentationRevision = nextRevision(presentationRevision);
          resourcePackSelection = null;
          resourcePackMaterial = null;
          return presentationSnapshot();
        }
        const intent = input.intent;
        const appearanceChange = intent.backendKind !== undefined || intent.avatarAssetRef !== undefined;
        if (appearanceChange) previousProfile = profile;
        presentationRevision = nextRevision(presentationRevision);
        profile = {
          backendKind: intent.backendKind ?? profile?.backendKind ?? null,
          avatarAssetRef: intent.avatarAssetRef ?? profile?.avatarAssetRef ?? '',
          expressionProfileRef: intent.expressionProfileRef ?? profile?.expressionProfileRef ?? '',
          idlePreset: intent.idlePreset ?? profile?.idlePreset ?? '',
          interactionPolicyRef: intent.interactionPolicyRef ?? profile?.interactionPolicyRef ?? '',
          defaultVoiceReference: intent.defaultVoiceReference ?? profile?.defaultVoiceReference ?? '',
          avatarAutoplay: intent.avatarAutoplay ?? profile?.avatarAutoplay ?? false,
          backgroundAssetRef: intent.backgroundAssetRef ?? profile?.backgroundAssetRef ?? '',
          revision: presentationRevision,
        };
        return presentationSnapshot();
      },
    },
    memory: {
      async inspect() {
        return memory;
      },
      async correct(input) {
        memory = {
          ...memory,
          outcome: 'committed',
          items: memory.items.map((item) => (item.memoryId === input.memoryId
            ? { ...item, content: input.correctedContent, epistemicStatus: 'explicit', updatedAt: new Date(now()).toISOString() }
            : item)),
        };
        return memoryMutation('committed', [input.memoryId]);
      },
      async forget(input) {
        const targets = new Set(input.memoryIds);
        const remaining = memory.items.filter((item) => !targets.has(item.memoryId));
        memory = {
          ...memory,
          outcome: 'forgotten',
          items: remaining,
          currentCount: remaining.filter((item) => item.lifecycle === 'current').length,
          forgottenCount: memory.forgottenCount + (memory.items.length - remaining.length),
        };
        return memoryMutation('forgotten', input.memoryIds);
      },
      async setEnabled(input) {
        memory = {
          ...memory,
          outcome: input.enabled ? 'ready' : 'unconfigured',
          enabled: input.enabled,
          adoptionRequired: false,
        };
        return memoryMutation('committed', []);
      },
      async deleteAll() {
        memory = {
          ...memory,
          outcome: 'deleted',
          items: [],
          currentCount: 0,
          supersededCount: 0,
          forgottenCount: 0,
          nextPageToken: null,
        };
        return memoryMutation('deleted', []);
      },
    },
    manager: {
      async snapshot(): Promise<ManagerSnapshot> {
        const hasCurrentMemory = memory.items.some((item) => item.lifecycle === 'current');
        const correctMemory = memory.adoptionRequired
          ? { state: 'unavailable' as const, reason: 'memory-adoption-required' as const }
          : !memory.enabled
            ? { state: 'unavailable' as const, reason: 'memory-disabled' as const }
            : { state: 'available' as const, reason: null };
        const available = { state: 'available' as const, reason: null };
        const activePartner = {
          ...partner,
          manager: {
            ...partner.manager,
            transcriptTurnCount: partner.manager.transcriptTurnCount + extraTurns,
          },
        };
        return {
          lifecycleStatus: partner.manager.lifecycleStatus,
          executionState: partner.manager.executionState,
          statusText: partner.manager.statusText,
          currentEmotion: partner.manager.currentEmotion,
          source: managerSource(activePartner, now()),
          context: managerContext(activePartner, hasCurrentMemory ? memory.currentCount : 0),
          actionAvailability: {
            getSharedAIConfig: available,
            overwriteSharedAIConfig: available,
            readAutonomy: available,
            updateAutonomy: available,
            inspectMemory: available,
            correctMemory,
            forgetMemory: correctMemory,
            switchMemory: available,
            deleteAllMemory: correctMemory,
            replaceAppearance: available,
            restorePreviousAppearance: previousProfile
              ? available
              : { state: 'unavailable', reason: 'previous-presentation-unavailable' },
          },
        };
      },
    },
  };

  const hostMechanics: AgentCenterHostMechanics = {
    async selectAvatar(kind) {
      await delay(pickerDelayMs);
      assetSequence += 1;
      const fileName = content.demo.avatarFileNames[kind];
      const avatarAssetReference = `demo-avatar-${partner.id}-${kind}-${assetSequence}`;
      return {
        intent: { backendKind: kind, avatarAssetReference },
        importedAssets: [{
          role: 'avatar',
          fileName,
          mediaType: kind === 'vrm' ? 'model/gltf-binary' : 'application/json',
          content: new TextEncoder().encode(avatarAssetReference),
          sha256: demoSha256(avatarAssetReference),
        }],
      };
    },
    async selectBackground() {
      await delay(pickerDelayMs);
      assetSequence += 1;
      const backgroundAssetReference = `demo-background-${partner.id}-${assetSequence}`;
      return {
        intent: { backgroundAssetReference },
        importedAssets: [{
          role: 'background',
          fileName: content.demo.backgroundFileName,
          mediaType: 'image/png',
          content: new TextEncoder().encode(backgroundAssetReference),
          sha256: demoSha256(backgroundAssetReference),
        }],
      };
    },
    async selectResourcePack() {
      await delay(pickerDelayMs);
      assetSequence += 1;
      const seed = `demo-pack-${partner.id}-${assetSequence}`;
      return {
        role: 'resource-pack',
        fileName: content.demo.resourcePackFileName,
        mediaType: 'application/vnd.nimi.resource-pack+zip',
        content: new TextEncoder().encode(seed),
        sha256: demoSha256(seed),
      };
    },
    async resolveCommittedPreview(input) {
      // The preview has no Avatar renderer behind it: report the committed
      // appearance as unavailable instead of faking pixels.
      return {
        state: 'unavailable',
        tier: 'avatar_preview_service',
        backendKind: input.backendKind,
        avatarAssetRef: input.avatarAssetRef,
        previewMaterialRef: null,
        previewImageRef: null,
        reason: '演示环境未运行内嵌形象预览。',
        warnings: [],
      };
    },
  };

  return {
    handle,
    client,
    hostMechanics,
    createResourcePackController() {
      return new DemoZhiyuResourcePackController(resourcePackFileNames);
    },
    noteConversationTurn() {
      extraTurns += 1;
    },
  };
}

export type DemoZhiyuAgentCenterSession = {
  readonly session: AgentCenterSession;
  readonly resourcePackController: DemoZhiyuResourcePackController;
};

/**
 * One kit session plus its Resource Pack controller. Disposing the session
 * disposes the controller too (kit semantics), so a partner re-selection
 * creates a fresh pair while the mock client keeps the partner's state.
 */
export function createDemoZhiyuAgentCenterSession(agent: DemoZhiyuAgentClient): DemoZhiyuAgentCenterSession {
  const resourcePackController = agent.createResourcePackController();
  const session = createAppAgentCenterSession({
    handle: agent.handle,
    client: agent.client,
    hostMechanics: agent.hostMechanics,
    resourcePackTargetController: resourcePackController,
  });
  return { session, resourcePackController };
}
