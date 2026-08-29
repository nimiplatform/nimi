import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAssetBody,
  NimiLocalAppAssetReadResult,
  NimiLocalAppAssetRecord,
  NimiLocalAppAssetsClient,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/history.js';
import type { StudioCapabilityRunInput, StudioCapabilityRunResult } from '../ai-studio-core/runtime-types.js';
import type { LabAIConfigSummary } from '../lab/lab-ai-config.js';
import type { LabImageHistoryRecord } from '../lab/lab-image-history.js';
import { runLabConversationJourney } from '../lab/local-app-conversation-journey.js';
import {
  type LabPreferences,
  type LabPromptDraftKey,
  type LabPromptDraftLoadResult,
  type LabPromptDraftSaveResult,
} from '../lab/lab-preferences.js';
import type { LabCanonicalRendererBindings } from '../renderer/contract.js';
import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import type {
  LabSimulatorJsonValue,
  LabSimulatorPrepareContext,
  LabSimulatorRouteState,
} from './protocol.js';

const PROMPT_DRAFT_STORAGE_KEY = 'nimiapp-lab:prompt-drafts:v1' as const;
const SIMULATED_AGENT_HANDLE = 'agent_ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as NimiLocalAppAgentHandle;
const SIMULATED_CONVERSATION_ANCHOR = 'sim-lab-conversation-anchor';

type JsonRecord = { readonly [key: string]: LabSimulatorJsonValue };

interface LabProjection extends JsonRecord {
  readonly scenario: JsonRecord;
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly assets: Readonly<Record<string, JsonRecord>>;
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly preferences: JsonRecord | null;
  readonly aiConfig: JsonRecord;
  readonly aiConfigRevision: number;
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function record(value: LabSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`LAB_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function projection(context: LabSimulatorPrepareContext): LabProjection {
  const value = record(context.projection.get(), 'PROJECTION');
  if (!isRecord(value.scenario)
    || !isRecord(value.runHistory)
    || !Array.isArray(value.imageHistory)
    || !isRecord(value.assets)
    || !isRecord(value.promptDrafts)
    || (value.preferences !== null && !isRecord(value.preferences))
    || !isRecord(value.aiConfig)
    || !Number.isSafeInteger(value.aiConfigRevision)
    || (value.ecosystemReference !== null && !isRecord(value.ecosystemReference))
    || (value.personaReference !== null && !isRecord(value.personaReference))) {
    throw new Error('LAB_SIMULATOR_PROJECTION_INVALID');
  }
  return value as unknown as LabProjection;
}

function normalizeJson(value: unknown, seen = new Set<object>()): LabSimulatorJsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => normalizeJson(entry, seen)).filter((entry) => entry !== undefined);
    seen.delete(value);
    return result as readonly LabSimulatorJsonValue[];
  }
  const result: Record<string, LabSimulatorJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeJson(entry, seen);
    if (normalized !== undefined) result[key] = normalized;
  }
  seen.delete(value);
  return result;
}

function commandJson(value: unknown): LabSimulatorJsonValue {
  const normalized = normalizeJson(value);
  if (normalized === undefined) throw new Error('LAB_SIMULATOR_COMMAND_PAYLOAD_INVALID');
  return normalized;
}

function simulatorError(code: string, message: string): Error & {
  readonly code: string;
  readonly reasonCode: string;
  readonly actionHint: string;
} {
  return Object.assign(new Error(message), {
    code,
    reasonCode: code,
    actionHint: 'use_declared_simulator_owner_result',
  });
}

function unavailable(name: string): never {
  throw simulatorError(
    'LAB_SIMULATED_SDK_METHOD_UNAVAILABLE',
    `${name} has no declared Simulator owner result.`,
  );
}

function effectUnavailable(name: string): never {
  throw simulatorError(
    'LAB_SIMULATED_EFFECT_UNAVAILABLE',
    `${name} has no Simulator Host mechanics.`,
  );
}

async function invoke(
  context: LabSimulatorPrepareContext,
  type: string,
  payload: unknown,
): Promise<JsonRecord> {
  const result = await context.commands.invoke(type, commandJson(payload));
  if (!result.ok) {
    throw simulatorError(
      'LAB_SIMULATED_ACTION_REJECTED',
      `${type} was rejected (${result.error.code}).`,
    );
  }
  return record(result.value, 'COMMAND_RESULT');
}

function promptDraftId(key: LabPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

function effectForbidden<TValue>(): NimiRendererHostResult<TValue> {
  return { ok: false, error: { disposition: 'effect-forbidden' } };
}

function hostUnavailable(): NimiRendererHostResult<{ readonly recorded: boolean }> {
  return { ok: false, error: { disposition: 'host-unavailable' } };
}

function assetFailure(reasonCode: string, message: string): never {
  throw Object.assign(new Error(message), {
    code: 'LAB_SIMULATED_ASSET_REJECTED',
    reasonCode,
    actionHint: 'provide_valid_app_private_asset_input',
  });
}

function assetPath(value: unknown): string {
  if (typeof value !== 'string') return assetFailure('invalid-path', 'Simulated asset path is invalid.');
  const components = value.split('/');
  const unicodeWellFormed = isWellFormedUnicode(value);
  if (!value || value.trim() !== value || !unicodeWellFormed || value.normalize('NFC') !== value
    || new TextEncoder().encode(value).byteLength > 240
    || value.startsWith('/') || value.endsWith('/') || /[\\\0<>:"|?*]/u.test(value)
    || components.length > 32
    || components.some((component) => !component || component === '.' || component === '..')) {
    return assetFailure('invalid-path', 'Simulated asset path is invalid.');
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assetRecord(value: JsonRecord): NimiLocalAppAssetRecord {
  const relativePath = assetPath(value.relativePath);
  if (!Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 0
    || typeof value.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    return assetFailure('integrity-failure', 'Simulated asset metadata is invalid.');
  }
  return {
    relativePath,
    ...(typeof value.mediaType === 'string' && value.mediaType ? { mediaType: value.mediaType } : {}),
    sizeBytes: Number(value.sizeBytes),
    sha256: value.sha256,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function assetBytes(value: JsonRecord): Uint8Array {
  if (!Array.isArray(value.body)
    || value.body.length > 32768
    || value.body.some((byte) => !Number.isSafeInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) {
    return assetFailure('integrity-failure', 'Simulated asset body is invalid.');
  }
  const bytes = Uint8Array.from(value.body as number[]);
  if (bytes.byteLength !== value.sizeBytes) return assetFailure('integrity-failure', 'Simulated asset size is invalid.');
  return bytes;
}

async function collectAssetBody(value: NimiLocalAppAssetBody): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const recordChunk = (chunk: Uint8Array): void => {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) return assetFailure('invalid-payload', 'Simulated asset chunk is invalid.');
    size += chunk.byteLength;
    if (size > 32768) return assetFailure('object-too-large', 'Simulated assets are bounded to 32 KiB.');
    chunks.push(new Uint8Array(chunk));
  };
  if (value instanceof Uint8Array) recordChunk(value);
  else if (typeof Blob !== 'undefined' && value instanceof Blob) recordChunk(new Uint8Array(await value.arrayBuffer()));
  else {
    const source = value as AsyncIterable<Uint8Array>;
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') return assetFailure('invalid-payload', 'Simulated asset body is invalid.');
    for await (const chunk of source) recordChunk(chunk);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function assetSha256(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function simulatedAssetPort(context: LabSimulatorPrepareContext): NimiLocalAppAssetsClient {
  const stat = async (relativePath: string): Promise<NimiLocalAppAssetRecord> => {
    const path = assetPath(relativePath);
    const value = projection(context).assets[path];
    if (!value) return assetFailure('not-found', `Simulated asset does not exist: ${path}`);
    return assetRecord(value);
  };
  return Object.freeze({
    stat,
    async list(input) {
      const prefix = input.prefix === '' ? '' : assetPath(input.prefix.endsWith('/') ? input.prefix.slice(0, -1) : input.prefix);
      const normalizedPrefix = input.prefix.endsWith('/') ? `${prefix}/` : prefix;
      const pageSize = input.pageSize ?? 100;
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) return assetFailure('invalid-cursor', 'Simulated asset page size is invalid.');
      const expectedCursorPrefix = encodeURIComponent(normalizedPrefix);
      const cursorMatch = input.cursor?.match(/^sim:(0|[1-9][0-9]*):(.*)$/u);
      if (input.cursor && (!cursorMatch || cursorMatch[2] !== expectedCursorPrefix)) return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
      const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
      const values = Object.entries(projection(context).assets)
        .filter(([path]) => normalizedPrefix === '' || (input.prefix.endsWith('/') ? path.startsWith(normalizedPrefix) : path === normalizedPrefix))
        .sort(([left], [right]) => left.localeCompare(right));
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > values.length) return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
      const assets = values.slice(offset, offset + pageSize).map(([, value]) => assetRecord(value));
      const nextOffset = offset + assets.length;
      return { assets, nextCursor: nextOffset < values.length ? `sim:${nextOffset}:${expectedCursorPrefix}` : '' };
    },
    async write(input) {
      const relativePath = assetPath(input.relativePath);
      if (projection(context).assets[relativePath] && input.overwrite !== true) return assetFailure('already-exists', `Simulated asset already exists: ${relativePath}`);
      const body = await collectAssetBody(input.body);
      await invoke(context, 'lab.asset.write', {
        relativePath,
        mediaType: input.mediaType ?? '',
        overwrite: input.overwrite === true,
        sizeBytes: body.byteLength,
        sha256: await assetSha256(body),
        body: [...body],
      });
      return stat(relativePath);
    },
    async read(input): Promise<NimiLocalAppAssetReadResult> {
      const relativePath = assetPath(input.relativePath);
      const value = projection(context).assets[relativePath];
      if (!value) return assetFailure('not-found', `Simulated asset does not exist: ${relativePath}`);
      const asset = assetRecord(value);
      const stored = assetBytes(value);
      const offset = input.offset ?? 0;
      const requestedLength = input.length;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > asset.sizeBytes
        || (requestedLength !== undefined && (!Number.isSafeInteger(requestedLength) || requestedLength <= 0))) {
        return assetFailure('invalid-range', 'Simulated asset range is invalid.');
      }
      const length = requestedLength === undefined ? asset.sizeBytes - offset : Math.min(requestedLength, asset.sizeBytes - offset);
      return {
        asset,
        range: { offset, length, totalSize: asset.sizeBytes },
        body: {
          async *[Symbol.asyncIterator]() {
            for (let cursor = offset; cursor < offset + length; cursor += 4096) {
              yield stored.slice(cursor, Math.min(cursor + 4096, offset + length));
            }
          },
        },
      };
    },
    async remove(relativePath) {
      const path = assetPath(relativePath);
      const removed = Boolean(projection(context).assets[path]);
      await invoke(context, 'lab.asset.remove', { relativePath: path });
      return { removed };
    },
    async move(input) {
      const from = assetPath(input.from);
      const to = assetPath(input.to);
      if (!projection(context).assets[from]) return assetFailure('not-found', `Simulated asset does not exist: ${from}`);
      if (projection(context).assets[to] && input.overwrite !== true) return assetFailure('already-exists', `Simulated asset already exists: ${to}`);
      await invoke(context, 'lab.asset.move', { from, to, overwrite: input.overwrite === true });
      return stat(to);
    },
    async reveal() { return unavailable('Local App asset reveal'); },
    async adoptArtifact(input) {
      const relativePath = assetPath(input.relativePath);
      await invoke(context, 'lab.asset.adopt', { artifactId: input.artifactId, relativePath, overwrite: input.overwrite === true });
      return stat(relativePath);
    },
  });
}

function simulatedAIConfigPort(context: LabSimulatorPrepareContext): LabCanonicalRendererBindings['sdk']['aiConfig'] {
  return Object.freeze({
    async get(): Promise<NimiAIConfigSnapshot> {
      return {
        config: projection(context).aiConfig as unknown as NimiAIConfigSnapshot['config'],
        revision: String(projection(context).aiConfigRevision),
        effectiveSelections: [],
      };
    },
    async overwrite(input) {
      const current = projection(context);
      if (input.expectedRevision !== String(current.aiConfigRevision)) {
        return {
          outcome: 'conflict' as const,
          config: current.aiConfig as unknown as NonNullable<NimiAIConfigSnapshot['config']>,
          revision: String(current.aiConfigRevision),
          reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const,
        };
      }
      await invoke(context, 'lab.ai-config.overwrite', input);
      const updated = projection(context);
      return {
        outcome: 'committed' as const,
        config: updated.aiConfig as unknown as NonNullable<NimiAIConfigSnapshot['config']>,
        revision: String(updated.aiConfigRevision),
      };
    },
    async listOptions(query) {
      if (query.kind === 'local-loadouts') {
        return {
          kind: 'local-loadouts' as const,
          options: query.capabilityContract === 'text.generate' ? [{
            loadoutRef: 'sim-lab-text-loadout',
            label: 'Simulator text model',
            capabilityContract: 'text.generate',
            implementation: {
              implementationId: 'sim.text',
              driverId: 'simulator',
              driverDialect: 'simulator/v1',
            },
            supportedFeatures: [],
            state: 'ready' as const,
            reasons: [],
          }] : [],
          truncated: false,
        };
      }
      if (query.kind === 'preset-voices') return { kind: 'preset-voices' as const, options: [], truncated: false };
      if (query.kind === 'cloud-connectors') return { kind: 'cloud-connectors' as const, options: [], truncated: false };
      return { kind: 'cloud-targets' as const, options: [], truncated: false };
    },
  });
}

class SimulatedOwnerQueue<TValue> implements AsyncIterable<TValue> {
  private readonly values: TValue[] = [];
  private readonly waiters: Array<(result: IteratorResult<TValue>) => void> = [];
  private closed = false;

  push(value: TValue): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<TValue> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<TValue>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

function simulatedFormalAppPort(
  context: LabSimulatorPrepareContext,
  aiConfig: LabCanonicalRendererBindings['sdk']['aiConfig'],
  assetPort: NimiLocalAppAssetsClient,
): NimiLocalAppClient {
  const references = Object.freeze([Object.freeze({
    agentHandle: SIMULATED_AGENT_HANDLE,
    displayName: 'Nimi Lab Agent',
    avatarUrl: '',
  })]);
  let sharedRevision = 1;
  let sharedCapabilities: readonly unknown[] = [];
  let autonomyRevision = 1;
  let autonomy = {
    enabled: false,
    config: { mode: 'off', dailyTokenBudget: 0, maxTokensPerHook: 0 },
    usedTokensInWindow: 0,
    budgetExhausted: false,
  };
  let presentationRevision = 1;
  let presentationProfile: Record<string, unknown> | null = null;
  let previousPresentationProfile: Record<string, unknown> | null = null;
  let memory = {
    outcome: 'ready',
    enabled: true,
    adoptionRequired: false,
    items: [] as Array<Record<string, unknown>>,
    currentCount: 0,
    supersededCount: 0,
    forgottenCount: 0,
    nextPageToken: null,
  };
  let conversationSequence = 0;
  const turns: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const conversationRequestIds = new Set<string>();
  const conversationQueues = new Set<SimulatedOwnerQueue<NimiLocalAppConversationEvent>>();
  let realtimeSequence = 1;
  let realtimeGeneration = 0;
  let realtimeLifecycle: 'ready' | 'closed' = 'closed';
  const realtimeQueues = new Set<SimulatedOwnerQueue<unknown>>();

  const requireAgent = (value: unknown): void => {
    if (value !== SIMULATED_AGENT_HANDLE) {
      throw simulatorError('LAB_SIMULATED_AGENT_HANDLE_STALE', 'The simulated Agent handle is not current.');
    }
  };
  const requireConversation = (input: Record<string, unknown>): void => {
    requireAgent(input.agentHandle);
    if (input.conversationAnchorId !== SIMULATED_CONVERSATION_ANCHOR) {
      throw simulatorError('LAB_SIMULATED_CONVERSATION_STALE', 'The simulated Conversation anchor is not current.');
    }
  };
  const requireRealtime = (input: Record<string, unknown>): void => {
    requireAgent(input.agentHandle);
    if (realtimeLifecycle !== 'ready'
      || input.realtimeSessionId !== 'sim-lab-realtime-session'
      || input.generation !== String(realtimeGeneration)) {
      throw simulatorError('LAB_SIMULATED_REALTIME_STALE', 'The simulated Realtime session is not current.');
    }
  };
  const participation = Object.freeze([
    { role: 'conversation.primary', capabilityContract: 'text.generate' },
    { role: 'memory.embedding', capabilityContract: 'text.embed' },
    { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
    { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
    { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
    { role: 'conversation.action.image', capabilityContract: 'image.generate' },
  ]);
  const sharedConfig = () => ({
    owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
    capabilities: sharedCapabilities,
  });
  const presentation = () => ({
    profile: presentationProfile,
    previousProfile: previousPresentationProfile,
    defaultVoiceReference: String(presentationProfile?.defaultVoiceReference ?? ''),
    avatarAutoplay: presentationProfile?.avatarAutoplay === true,
    presentationRevision: String(presentationRevision),
  });
  const memoryProjection = () => ({ ...memory, items: [...memory.items] });
  const available = Object.freeze({ state: 'available' as const, reason: null });
  const actionAvailability = () => ({
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
    restorePreviousAppearance: previousPresentationProfile
      ? available
      : { state: 'unavailable' as const, reason: 'previous-presentation-unavailable' as const },
  });
  const managerSnapshot = () => ({
    lifecycleStatus: 'active' as const,
    executionState: 'idle' as const,
    statusText: 'Simulator owner ready',
    currentEmotion: 'calm',
    source: {
      ready: true,
      state: 'ready' as const,
      reasonCode: 'none' as const,
      capturedAt: { seconds: String(Math.floor(context.clock.now() / 1_000)), nanos: 0 },
      coverageSections: [{ section: 'identity' as const, state: 'complete' as const, requiredCount: 1, resolvedCount: 1, omittedCount: 0 }],
      lorebookReady: true,
      lorebookItemCount: 0,
      lorebookEstimatedTokens: '0',
    },
    context: {
      ready: true,
      state: 'ready' as const,
      reasonCode: 'none' as const,
      lanes: [{ laneId: 'source_identity' as const, state: 'included' as const, includedItemCount: 1, omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '64', usedTokens: '16' }],
      inputBudgetTokens: '1024',
      usedTokens: '16',
      requiredInputTokens: '16',
      requiredContextWindowTokens: '256',
      truncation: [{ reason: 'none' as const, omittedItemCount: 0, truncatedItemCount: 0 }],
      transcriptTurnCount: turns.length,
      memoryItemCount: memory.items.length,
      mediaCount: 0,
      toolCount: 0,
      sourceAdapterStatus: 'ready' as const,
      sourceSelectionStatus: 'ready' as const,
      conversationSummaryStatus: turns.length ? 'ready' as const : 'absent' as const,
      privateRecallCount: 0,
    },
    actionAvailability: actionAvailability(),
  });
  const realtimeControl = () => ({
    realtimeSessionId: 'sim-lab-realtime-session',
    channelId: 'sim-lab-realtime-channel',
    subscriptionId: 'sim-lab-realtime-subscription',
    adapterKind: 'local-agent' as const,
    lifecycle: realtimeLifecycle,
    generation: String(realtimeGeneration),
    sequence: String(realtimeSequence),
    correlationId: 'sim-lab-realtime-correlation',
    backpressure: 'normal' as const,
    bufferedItems: 0,
    bufferCapacity: 16,
    terminalReason: realtimeLifecycle === 'closed' ? 'cancelled' : '',
    actionHint: '',
    occurredAt: null,
  });

  return Object.freeze({
    auth: Object.freeze({
      async status() {
        return {
          mode: 'local-app' as const,
          state: 'session-bound' as const,
          sessionBound: true,
          reasonCode: 'ACTION_EXECUTED',
          actionHint: '',
          retryable: false,
        };
      },
    }),
    currentUser: Object.freeze({ async get() { return unavailable('Current user display'); } }),
    ai: Object.freeze({
      text: Object.freeze({
        async generateCandidate(
          input: Parameters<NimiLocalAppClient['ai']['text']['generateCandidate']>[0],
        ) {
          const messages = Array.isArray(input.messages) ? input.messages : [];
          const prompt = messages
            .filter((message) => message.role === 'user')
            .map((message) => message.text.trim())
            .filter(Boolean)
            .join('\n');
          if (!prompt) {
            throw simulatorError(
              'LAB_SIMULATED_INPUT_INVALID',
              'The simulated text owner result requires a non-empty user message.',
            );
          }
          const accepted = await invoke(context, 'lab.capability.execute', {
            capabilityId: 'text.generate',
            prompt,
          });
          if (!Number.isSafeInteger(accepted.revision)) {
            throw simulatorError(
              'LAB_SIMULATED_OWNER_RESULT_INVALID',
              'The simulated text owner revision is invalid.',
            );
          }
          const generatedText = projection(context).scenario.generatedText;
          if (typeof generatedText !== 'string' || !generatedText) {
            throw simulatorError(
              'LAB_SIMULATED_OWNER_RESULT_INVALID',
              'The simulated text owner result is invalid.',
            );
          }
          return {
            text: generatedText,
            finishReason: 'stop' as const,
            traceId: `sim-lab-text-${String(accepted.revision)}`,
          };
        },
        async streamTurn() { return unavailable('Local App text stream'); },
      }),
      scenario: Object.freeze({ async execute() { return unavailable('Local App Scenario execution'); } }),
      scenarioJobs: Object.freeze({
        async submit() { return unavailable('Local App Scenario Job submit'); },
        async get() { return unavailable('Local App Scenario Job get'); },
        async subscribe() { return unavailable('Local App Scenario Job subscribe'); },
        async cancel() { return unavailable('Local App Scenario Job cancel'); },
      }),
      artifacts: Object.freeze({
        async read() { return unavailable('Local App artifact read'); },
        async upload() { return unavailable('Local App artifact upload'); },
      }),
      voiceAssets: Object.freeze({ async list() { return unavailable('Local App voice asset list'); } }),
      realtime: Object.freeze({
        async open() { return unavailable('AI Realtime open'); },
        async appendInput() { return unavailable('AI Realtime append'); },
        async submitOwnerControl() { return unavailable('AI Realtime owner control'); },
        async subscribe() { return unavailable('AI Realtime subscribe'); },
        async interruptOutput() { return unavailable('AI Realtime interrupt'); },
        async close() { return unavailable('AI Realtime close'); },
      }),
    }),
    aiConfig,
    storage: Object.freeze({
      async readJson() { return unavailable('App-private JSON read'); },
      async writeJson() { return unavailable('App-private JSON write'); },
      async removeJson() { return unavailable('App-private JSON remove'); },
      assets: assetPort,
    }),
    realm: Object.freeze({
      chat: Object.freeze({ async list() { return unavailable('Realm chat list'); } }),
      worldCore: Object.freeze({
        async list() { return unavailable('Realm World Core list'); },
        async create() { return unavailable('Realm World Core create'); },
      }),
      personaCharacter: Object.freeze({
        async listOwned() { return unavailable('PersonaCharacter list'); },
        async getOwned() { return unavailable('PersonaCharacter get'); },
        async create() { return unavailable('PersonaCharacter create'); },
        async replace() { return unavailable('PersonaCharacter replace'); },
        async delete() { return unavailable('PersonaCharacter delete'); },
      }),
      realtime: Object.freeze({
        async open() { return unavailable('Realm Realtime open'); },
        async subscribe() { return unavailable('Realm Realtime subscribe'); },
        async ack() { return unavailable('Realm Realtime acknowledge'); },
        async closeSubscription() { return unavailable('Realm Realtime subscription close'); },
        async closeChannel() { return unavailable('Realm Realtime channel close'); },
      }),
    }),
    agents: Object.freeze({ async listReferences() { return references; } }),
    agentConfigure: Object.freeze({
      sharedAIConfig: Object.freeze({
        async get() {
          return { config: sharedConfig(), revision: String(sharedRevision), effectiveSelections: [], participation };
        },
        async overwrite(input: { readonly expectedRevision: string; readonly capabilities: readonly unknown[] }) {
          if (input.expectedRevision !== String(sharedRevision)) {
            return { outcome: 'conflict' as const, config: sharedConfig(), revision: String(sharedRevision), participation, reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const };
          }
          sharedCapabilities = [...input.capabilities];
          sharedRevision += 1;
          return { outcome: 'committed' as const, config: sharedConfig(), revision: String(sharedRevision), participation };
        },
        async listOptions(query: { readonly kind: string; readonly capabilityContract?: string }) {
          if (query.kind === 'local-loadouts') {
            return {
              kind: 'local-loadouts' as const,
              options: query.capabilityContract === 'text.generate' ? [{
                loadoutRef: 'sim-lab-text-loadout', label: 'Simulator text model', capabilityContract: 'text.generate',
                implementation: { implementationId: 'sim.text', driverId: 'simulator', driverDialect: 'simulator/v1' },
                supportedFeatures: [], state: 'ready' as const, reasons: [],
              }] : [],
              truncated: false,
            };
          }
          return { kind: query.kind, options: [], truncated: false };
        },
      }),
      autonomy: Object.freeze({
        async snapshot(input: { readonly agentHandle: unknown }) {
          requireAgent(input.agentHandle);
          return { ...autonomy, autonomyRevision: String(autonomyRevision) };
        },
        async update(input: { readonly agentHandle: unknown; readonly expectedAutonomyRevision: string; readonly intent: { readonly enabled?: boolean; readonly config?: Record<string, unknown> } }) {
          requireAgent(input.agentHandle);
          if (input.expectedAutonomyRevision !== String(autonomyRevision)) throw simulatorError('AUTONOMY_REVISION_CONFLICT', 'The simulated autonomy revision changed.');
          autonomyRevision += 1;
          autonomy = { ...autonomy, enabled: input.intent.enabled ?? autonomy.enabled, config: { ...autonomy.config, ...(input.intent.config ?? {}) } as typeof autonomy.config };
          return { ...autonomy, autonomyRevision: String(autonomyRevision) };
        },
      }),
      presentation: Object.freeze({
        async snapshot(input: { readonly agentHandle: unknown }) { requireAgent(input.agentHandle); return presentation(); },
        async readAsset(input: { readonly agentHandle: unknown }) { requireAgent(input.agentHandle); return unavailable('Agent presentation asset read'); },
        async commit(input: { readonly agentHandle: unknown; readonly expectedPresentationRevision: string; readonly intent: Record<string, unknown> }) {
          requireAgent(input.agentHandle);
          if (input.expectedPresentationRevision !== String(presentationRevision)) throw simulatorError('PRESENTATION_REVISION_CONFLICT', 'The simulated presentation revision changed.');
          previousPresentationProfile = presentationProfile;
          presentationRevision += 1;
          presentationProfile = {
            backendKind: input.intent.backendKind ?? presentationProfile?.backendKind ?? null,
            avatarAssetRef: input.intent.avatarAssetRef ?? presentationProfile?.avatarAssetRef ?? '',
            expressionProfileRef: input.intent.expressionProfileRef ?? presentationProfile?.expressionProfileRef ?? '',
            idlePreset: input.intent.idlePreset ?? presentationProfile?.idlePreset ?? '',
            interactionPolicyRef: input.intent.interactionPolicyRef ?? presentationProfile?.interactionPolicyRef ?? '',
            defaultVoiceReference: input.intent.defaultVoiceReference ?? presentationProfile?.defaultVoiceReference ?? '',
            avatarAutoplay: input.intent.avatarAutoplay ?? presentationProfile?.avatarAutoplay ?? false,
            backgroundAssetRef: input.intent.backgroundAssetRef ?? presentationProfile?.backgroundAssetRef ?? '',
            revision: String(presentationRevision),
          };
          return presentation();
        },
      }),
      memory: Object.freeze({
        async inspect(input: { readonly agentHandle: unknown }) { requireAgent(input.agentHandle); return memoryProjection(); },
        async correct(input: { readonly agentHandle: unknown; readonly memoryId: string; readonly correctedContent: string }) {
          requireAgent(input.agentHandle);
          if (!memory.items.some((item) => item.memoryId === input.memoryId)) {
            return { outcome: 'no_effect' as const, affectedMemoryIds: [], projection: memoryProjection() };
          }
          memory = { ...memory, outcome: 'committed', items: memory.items.map((item) => item.memoryId === input.memoryId ? { ...item, content: input.correctedContent, epistemicStatus: 'explicit', updatedAt: new Date(context.clock.now()).toISOString() } : item) };
          return { outcome: 'committed' as const, affectedMemoryIds: [input.memoryId], projection: memoryProjection() };
        },
        async forget(input: { readonly agentHandle: unknown; readonly memoryIds: readonly string[] }) {
          requireAgent(input.agentHandle);
          const targets = new Set(input.memoryIds);
          const removed = memory.items.filter((item) => targets.has(String(item.memoryId))).length;
          if (removed === 0) return { outcome: 'no_effect' as const, affectedMemoryIds: [], projection: memoryProjection() };
          memory = { ...memory, outcome: 'forgotten', items: memory.items.filter((item) => !targets.has(String(item.memoryId))), currentCount: memory.items.length - removed, forgottenCount: memory.forgottenCount + removed };
          return { outcome: 'forgotten' as const, affectedMemoryIds: [...input.memoryIds], projection: memoryProjection() };
        },
        async setEnabled(input: { readonly agentHandle: unknown; readonly enabled: boolean }) {
          requireAgent(input.agentHandle);
          if (memory.enabled === input.enabled && !memory.adoptionRequired) {
            return { outcome: 'no_effect' as const, affectedMemoryIds: [], projection: memoryProjection() };
          }
          memory = { ...memory, outcome: input.enabled ? 'ready' : 'unconfigured', enabled: input.enabled, adoptionRequired: false };
          return { outcome: 'committed' as const, affectedMemoryIds: [], projection: memoryProjection() };
        },
        async deleteAll(input: { readonly agentHandle: unknown }) {
          requireAgent(input.agentHandle);
          if (memory.items.length === 0) return { outcome: 'no_effect' as const, affectedMemoryIds: [], projection: memoryProjection() };
          memory = { ...memory, outcome: 'deleted', items: [], currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null };
          return { outcome: 'deleted' as const, affectedMemoryIds: [], projection: memoryProjection() };
        },
      }),
      manager: Object.freeze({ async snapshot(input: { readonly agentHandle: unknown }) { requireAgent(input.agentHandle); return managerSnapshot(); } }),
    }),
    conversation: Object.freeze({
      async open(input: { readonly agentHandle: unknown }) { requireAgent(input.agentHandle); return { conversationAnchorId: SIMULATED_CONVERSATION_ANCHOR, activeTurnId: null }; },
      async send(input: Record<string, unknown>) {
        requireConversation(input);
        if (typeof input.requestId !== 'string' || !input.requestId || !Array.isArray(input.parts)) throw simulatorError('LAB_SIMULATED_CONVERSATION_INPUT_INVALID', 'The simulated Conversation input is invalid.');
        if (conversationRequestIds.has(input.requestId)) throw simulatorError('LAB_SIMULATED_CONVERSATION_DUPLICATE', 'The simulated Conversation request ID was already used.');
        const text = input.parts.flatMap((part) => isRecord(part) && part.kind === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n').trim();
        if (!text) throw simulatorError('LAB_SIMULATED_CONVERSATION_INPUT_INVALID', 'The simulated Conversation requires text.');
        const generated = projection(context).scenario.generatedText;
        if (typeof generated !== 'string' || !generated) throw simulatorError('LAB_SIMULATED_OWNER_RESULT_INVALID', 'The simulated Conversation result is invalid.');
        const turnId = `sim-lab-turn-${turns.length + 1}`;
        conversationRequestIds.add(input.requestId);
        const userMessage = { messageId: `${turnId}:user`, turnId, role: 'user' as const, parts: [{ kind: 'text' as const, text }] };
        const assistantMessage = { messageId: `${turnId}:assistant`, turnId, role: 'assistant' as const, parts: [{ kind: 'text' as const, text: generated }] };
        turns.push({ turnId, status: 'completed', phase: null, terminalReason: 'stop', reasonCode: null, message: null });
        messages.push(userMessage, assistantMessage);
        conversationSequence += 1;
        const accepted = { type: 'turn-accepted' as const, conversationAnchorId: SIMULATED_CONVERSATION_ANCHOR, sequence: String(conversationSequence), turnId };
        for (const queue of conversationQueues) queue.push(accepted);
        for (const message of [userMessage, assistantMessage]) {
          conversationSequence += 1;
          const event = { type: 'message-committed' as const, conversationAnchorId: SIMULATED_CONVERSATION_ANCHOR, sequence: String(conversationSequence), turnId, message };
          for (const queue of conversationQueues) queue.push(event);
        }
        conversationSequence += 1;
        const terminal = { type: 'turn-completed' as const, conversationAnchorId: SIMULATED_CONVERSATION_ANCHOR, sequence: String(conversationSequence), turnId, terminalReason: 'stop' as const };
        for (const queue of conversationQueues) queue.push(terminal);
        return { turnId };
      },
      async subscribe(input: Record<string, unknown>) {
        requireConversation(input);
        const queue = new SimulatedOwnerQueue<NimiLocalAppConversationEvent>();
        conversationQueues.add(queue);
        return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), async cancel() { conversationQueues.delete(queue); queue.close(); } };
      },
      async snapshot(input: Record<string, unknown>) {
        requireConversation(input);
        return { conversationAnchorId: SIMULATED_CONVERSATION_ANCHOR, throughSequence: String(conversationSequence), turns: [...turns], messages: [...messages], actions: [], voices: [], truncatedBefore: false };
      },
      async interruptTurn(input: Record<string, unknown>) {
        requireConversation(input);
        throw simulatorError('LAB_SIMULATED_NO_ACTIVE_TURN', 'The simulated Conversation has no active turn to interrupt.');
      },
      async uploadAttachment() { return unavailable('Conversation attachment upload'); },
      async readArtifact() { return unavailable('Conversation artifact read'); },
      async transcribeVoice() { return unavailable('Conversation voice transcription'); },
      async renderVoice() { return unavailable('Conversation voice render'); },
    }),
    agentRealtime: Object.freeze({
      async open(input: Record<string, unknown>) {
        requireAgent(input.agentHandle);
        realtimeLifecycle = 'ready';
        realtimeGeneration += 1;
        realtimeSequence += 1;
        return { conversationAnchorId: typeof input.conversationAnchorId === 'string' ? input.conversationAnchorId : SIMULATED_CONVERSATION_ANCHOR, realtimeSessionId: 'sim-lab-realtime-session', channelId: 'sim-lab-realtime-channel', generation: String(realtimeGeneration), negotiatedInputAudio: input.inputAudio, negotiatedOutputAudio: input.inputAudio, control: realtimeControl() };
      },
      async appendInput(input: Record<string, unknown>) { requireRealtime(input); realtimeSequence += 1; return { ack: { ok: true, reasonCode: '', actionHint: '' }, control: realtimeControl() }; },
      async subscribe(input: Record<string, unknown>) {
        requireRealtime(input);
        const queue = new SimulatedOwnerQueue<unknown>();
        realtimeQueues.add(queue);
        return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), async cancel() { realtimeQueues.delete(queue); queue.close(); } };
      },
      async status(input: Record<string, unknown>) { requireRealtime(input); return realtimeControl(); },
      async interruptOutput(input: Record<string, unknown>) { requireRealtime(input); realtimeSequence += 1; return { ack: { ok: true, reasonCode: '', actionHint: '' }, control: realtimeControl() }; },
      async close(input: Record<string, unknown>) {
        requireRealtime(input);
        realtimeLifecycle = 'closed';
        realtimeSequence += 1;
        for (const queue of realtimeQueues) queue.close();
        realtimeQueues.clear();
        return { ack: { ok: true, reasonCode: '', actionHint: '' }, control: realtimeControl() };
      },
    }),
    embodiment: Object.freeze({
      async snapshot() { return unavailable('Agent embodiment snapshot'); },
      async subscribe() { return unavailable('Agent embodiment subscribe'); },
    }),
  }) as unknown as NimiLocalAppClient;
}

function nonSuccess(
  input: StudioCapabilityRunInput,
  reason: 'input-invalid' | 'operation-aborted' | 'sdk-method-unavailable',
  message: string,
): StudioCapabilityRunResult {
  return {
    ok: false,
    capabilityId: input.capabilityId,
    reason,
    message,
    actionHint: reason === 'input-invalid'
      ? 'provide_valid_input'
      : reason === 'operation-aborted'
        ? 'retry_when_ready'
        : 'use_declared_simulator_owner_result',
    diagnostics: {
      reasonCode: reason === 'sdk-method-unavailable'
        ? 'LAB_SIMULATED_SDK_METHOD_UNAVAILABLE'
        : reason === 'operation-aborted'
          ? 'LAB_SIMULATED_OPERATION_ABORTED'
          : 'LAB_SIMULATED_INPUT_INVALID',
      source: 'sdk',
    },
  };
}

function createSdkPort(context: LabSimulatorPrepareContext): LabCanonicalRendererBindings['sdk'] {
  const aiConfig = simulatedAIConfigPort(context);
  const assetPort = simulatedAssetPort(context);
  const localAppClient = simulatedFormalAppPort(context, aiConfig, assetPort);
  return Object.freeze({
    localAppClient,
    async runCapability(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult> {
      if (input.capabilityId !== 'text.generate') {
        return nonSuccess(
          input,
          'sdk-method-unavailable',
          'This capability has no declared Simulator owner result.',
        );
      }
      if (input.signal?.aborted) {
        return nonSuccess(input, 'operation-aborted', 'The simulated owner call was aborted before mutation.');
      }
      const prompt = input.prompt.trim();
      if (!prompt || input.attachments?.length) {
        return nonSuccess(input, 'input-invalid', 'The simulated text owner result accepts non-empty text only.');
      }
      const parameters = isRecord(input.parameters) ? input.parameters : {};
      const result = await localAppClient.ai.text.generateCandidate({
        messages: [{ role: 'user', text: prompt }],
        ...(typeof parameters.temperature === 'number' ? { temperature: parameters.temperature } : {}),
        ...(typeof parameters.topP === 'number' ? { topP: parameters.topP } : {}),
        ...(typeof parameters.maxTokens === 'number' ? { maxTokens: parameters.maxTokens } : {}),
        ...(typeof parameters.topK === 'number' ? { topK: parameters.topK } : {}),
        ...(typeof parameters.presencePenalty === 'number' ? { presencePenalty: parameters.presencePenalty } : {}),
        ...(typeof parameters.frequencyPenalty === 'number' ? { frequencyPenalty: parameters.frequencyPenalty } : {}),
        ...(Array.isArray(parameters.stop)
          && parameters.stop.every((value) => typeof value === 'string')
          ? { stop: parameters.stop as string[] }
          : {}),
        ...(typeof parameters.seed === 'number' ? { seed: parameters.seed } : {}),
      });
      return {
        ok: true,
        capabilityId: input.capabilityId,
        capabilityLabel: 'Text Studio',
        message: 'Completed through the canonical Lab client with a declared Simulator owner result.',
        output: {
          kind: 'text',
          text: result.text,
          finishReason: result.finishReason,
          inputTokens: prompt.length,
          outputTokens: result.text.length,
          totalTokens: prompt.length + result.text.length,
          streamed: false,
        },
        trace: result.traceId ? { traceId: result.traceId } : undefined,
      };
    },
    async listLocalAppVoiceAssets() { return unavailable('Local App voice asset list'); },
    async uploadLocalAppArtifact() { return unavailable('Local App artifact upload'); },
    aiConfig,
    storage: Object.freeze({ assets: assetPort }),
    settings: Object.freeze({
      async notificationUnread() { return unavailable('Notification unread projection'); },
      async notifications() { return unavailable('Notification list projection'); },
      async creatorEligibility() { return unavailable('Creator eligibility projection'); },
      async humanChats() { return unavailable('Human chat projection'); },
    }),
  });
}

function createCommandPort(
  context: LabSimulatorPrepareContext,
  client: NimiLocalAppClient,
): LabCanonicalRendererBindings['app']['commands'] {
  let conversationRequestSequence = 0;
  return Object.freeze({
    async nextRunIdentity() {
      const accepted = await invoke(context, 'lab.run.allocate', {});
      const revision = accepted.revision;
      if (!Number.isSafeInteger(revision)) {
        throw simulatorError('LAB_SIMULATED_OWNER_RESULT_INVALID', 'The simulated run identity is invalid.');
      }
      return { runId: `lab-run-${revision}`, createdAt: new Date(context.clock.now()).toISOString() };
    },
    async appendRunHistory(historyRecord: StudioRunHistoryRecord) {
      await invoke(context, 'lab.history.append', { record: historyRecord });
      return projection(context).runHistory as unknown as StudioRunHistory;
    },
    async removeRunHistory(recordId: string) {
      await invoke(context, 'lab.history.remove', { recordId });
      return projection(context).runHistory as unknown as StudioRunHistory;
    },
    async clearRunHistory(input: { readonly capabilityId?: string }) {
      await invoke(context, 'lab.history.clear', { capabilityId: input.capabilityId ?? null });
      return projection(context).runHistory as unknown as StudioRunHistory;
    },
    async appendImageHistory(imageRecord: LabImageHistoryRecord) {
      await invoke(context, 'lab.image-history.append', { record: imageRecord });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async removeImageHistory(runId: string) {
      await invoke(context, 'lab.image-history.remove', { runId });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async clearImageHistory(input: { readonly capabilityId?: string }) {
      await invoke(context, 'lab.image-history.clear', { capabilityId: input.capabilityId ?? null });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async savePreferences(preferences: LabPreferences) {
      await invoke(context, 'lab.preferences.save', { preferences });
    },
    async savePromptDraft(
      key: LabPromptDraftKey,
      prompt: string,
      enabled: boolean,
    ): Promise<LabPromptDraftSaveResult> {
      try {
        await invoke(context, 'lab.prompt.save', { key, prompt, enabled });
        return {
          status: {
            state: enabled ? 'ready' : 'disabled',
            storageKey: PROMPT_DRAFT_STORAGE_KEY,
            message: enabled
              ? 'Prompt draft saved in Simulator owner state.'
              : 'Prompt draft persistence is disabled.',
          },
        };
      } catch (error) {
        return {
          status: {
            state: 'write-error',
            storageKey: PROMPT_DRAFT_STORAGE_KEY,
            message: 'Prompt draft was not committed to Simulator owner state.',
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async copyText() { return effectForbidden<{ readonly copied: boolean }>(); },
    async exportText() { return effectForbidden<{ readonly filename: string }>(); },
    async resolveWorldTourFixture() { return effectUnavailable('World Tour fixture resolution'); },
    async openWorldTourWindow() { return effectUnavailable('World Tour window open'); },
    async claimWorldTourViewerLaunch() { return effectUnavailable('World Tour viewer launch'); },
    async saveWorldTourViewerPreset() { return effectUnavailable('World Tour preset save'); },
    async localAppSessionStatus() {
      const status = await client.auth.status();
      return { state: status.state, sessionBound: status.sessionBound };
    },
    async localAppConversationJourney(input: Parameters<LabCanonicalRendererBindings['app']['commands']['localAppConversationJourney']>[0]) {
      conversationRequestSequence += 1;
      return runLabConversationJourney({
        conversation: client.conversation,
        agentHandle: input.agentHandle,
        requestId: `sim-lab-command-turn-${conversationRequestSequence}`,
        text: input.text,
      });
    },
    async localAppConversationSnapshot(input: Parameters<LabCanonicalRendererBindings['app']['commands']['localAppConversationSnapshot']>[0]) {
      return client.conversation.snapshot(input);
    },
    async localAppStorageRoundTrip() { return effectUnavailable('App-private storage round trip'); },
    async runtimeLog(input: Readonly<Record<string, unknown>>) {
      try {
        await invoke(context, 'lab.action.record', { kind: 'telemetry-runtime', channel: 'runtime-log', details: input });
        return { ok: true as const, value: { recorded: true } };
      } catch {
        return hostUnavailable();
      }
    },
    async rendererLog(input: Readonly<Record<string, unknown>>) {
      try {
        await invoke(context, 'lab.action.record', { kind: 'telemetry-renderer', channel: 'renderer-log', details: input });
        return { ok: true as const, value: { recorded: true } };
      } catch {
        return hostUnavailable();
      }
    },
  });
}

export function createLabSimulatorBindings(
  context: LabSimulatorPrepareContext,
): LabCanonicalRendererBindings {
  let currentRoute = context.route.get();
  const routeListeners = new Set<() => void>();
  const ecosystemListeners = new Set<(payload: unknown) => void>();
  const personaListeners = new Set<(payload: unknown) => void>();
  let observedEcosystemRevision = 0;
  let observedPersonaInteraction = '';
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const unsubscribeProjection = context.projection.subscribe(() => {
    const value = projection(context);
    const ecosystem = value.ecosystemReference;
    if (ecosystem && Number.isSafeInteger(ecosystem.ecosystemRevision)) {
      const revision = ecosystem.ecosystemRevision as number;
      if (revision > observedEcosystemRevision) {
        observedEcosystemRevision = revision;
        for (const listener of ecosystemListeners) listener({ ecosystemRevision: revision });
      }
    }
    const personaReference = value.personaReference;
    const interactionId = typeof personaReference?.interactionId === 'string'
      ? personaReference.interactionId
      : '';
    if (personaReference && interactionId && interactionId !== observedPersonaInteraction) {
      observedPersonaInteraction = interactionId;
      const persona = isRecord(personaReference.persona) ? personaReference.persona : null;
      if (persona && typeof persona.displayName === 'string' && typeof persona.userId === 'string') {
        for (const listener of personaListeners) listener({
          displayName: persona.displayName,
          userId: persona.userId,
          role: typeof persona.role === 'string' ? persona.role : '',
        });
      }
    }
  });
  const cleanup = context.cleanup.add(() => {
    routeListeners.clear();
    ecosystemListeners.clear();
    personaListeners.clear();
    unsubscribeRoute();
    unsubscribeProjection();
  });
  if (!cleanup.ok) throw new Error('LAB_SIMULATOR_CLEANUP_REJECTED');
  const sdk = createSdkPort(context);
  return createNimiCanonicalRendererHostBindings({
    scope: context.kit.scope,
    capabilities: context.kit.capabilities,
    localization: context.kit.localization,
    kit: context.kit,
    sdk,
    app: {
      projection: Object.freeze({
        async runtimePlatform() {
          return projection(context).scenario.runtimePlatform as unknown as RuntimePlatformProjection;
        },
        async aiConfigSummary() {
          return projection(context).scenario.aiConfigSummary as unknown as LabAIConfigSummary;
        },
        async runHistory() {
          return projection(context).runHistory as unknown as StudioRunHistory;
        },
        async imageHistory() {
          return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
        },
        ecosystemReference() {
          const reference = projection(context).ecosystemReference;
          return reference && Number.isSafeInteger(reference.ecosystemRevision)
            ? { ecosystemRevision: reference.ecosystemRevision as number }
            : null;
        },
        personaReference() {
          const reference = projection(context).personaReference;
          const persona = reference && isRecord(reference.persona) ? reference.persona : null;
          return persona && typeof persona.displayName === 'string' && typeof persona.userId === 'string'
            ? {
                displayName: persona.displayName,
                userId: persona.userId,
                role: typeof persona.role === 'string' ? persona.role : '',
              }
            : null;
        },
        preferences() {
          const value = projection(context).preferences;
          return (value ?? {
            schemaVersion: 1,
            draftPersistence: true,
            verboseConsole: false,
            historyPanel: { collapsed: true, scope: 'capability', hideFailures: false },
            lastCapabilityId: null,
          }) as unknown as LabPreferences;
        },
        promptDraft(key: LabPromptDraftKey, enabled: boolean): LabPromptDraftLoadResult {
          if (!enabled) {
            return {
              prompt: null,
              status: {
                state: 'disabled',
                storageKey: PROMPT_DRAFT_STORAGE_KEY,
                message: 'Prompt draft persistence is disabled.',
              },
            };
          }
          const prompt = projection(context).promptDrafts[promptDraftId(key)] ?? null;
          return {
            prompt,
            status: {
              state: prompt === null ? 'defaulted' : 'ready',
              storageKey: PROMPT_DRAFT_STORAGE_KEY,
              message: prompt === null
                ? 'No Simulator owner prompt draft exists.'
                : 'Simulator owner prompt draft loaded.',
            },
          };
        },
      }),
      commands: createCommandPort(context, sdk.localAppClient),
      events: Object.freeze({
        subscribe(eventType: string, listener: (payload: unknown) => void) {
          if (eventType === 'lab.ecosystem.reference-updated') {
            ecosystemListeners.add(listener);
            return () => ecosystemListeners.delete(listener);
          }
          if (eventType === 'lab.persona.reference-updated') {
            personaListeners.add(listener);
            return () => personaListeners.delete(listener);
          }
          throw simulatorError('LAB_SIMULATED_EVENT_UNDECLARED', `Event ${eventType} is not declared.`);
        },
      }),
    },
    route: Object.freeze({
      get: () => currentRoute,
      subscribe(listener: () => void) {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
      async navigate(next: LabSimulatorRouteState) {
        const result = await context.route.navigate(next);
        if (!result.ok) {
          throw simulatorError('LAB_SIMULATED_ROUTE_REJECTED', 'The simulated route update was rejected.');
        }
      },
    }),
    clock: Object.freeze({ now: () => context.clock.now() }),
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
