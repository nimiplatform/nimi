import type {
  ConversationContinuityAdapter,
  ConversationProjectionRebuildResult,
  ConversationRuntimeTextStreamPart,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnHistoryMessage,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import { buildDesktopChatOutputContractSection } from './chat-output-contract';
import type { ChatThinkingPreference } from './chat-thinking';
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
} from './conversation-capability';

const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: true,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: true,
  videoGeneration: false,
} as const;

type AgentLocalChatStoreClient = Pick<
  typeof chatAgentStoreClient,
  'loadTurnContext' | 'commitTurnResult' | 'cancelTurn' | 'rebuildProjection'
>;

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  prompt: string;
  threadId: string;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
};

export type AgentLocalChatImageRequest = {
  prompt: string;
  imageExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
};

export interface AgentLocalChatRuntimeAdapter {
  streamText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
  invokeText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ text: string; traceId: string; promptTraceId: string }>;
  generateImage: (
    request: AgentLocalChatImageRequest,
  ) => Promise<{ mediaUrl: string; mimeType: string; artifactId: string | null; traceId: string }>;
}

export type AgentLocalChatProviderMetadata = {
  agentId: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  imageExecutionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
};

type AgentLocalChatImageState =
  | {
    status: 'none';
  }
  | {
    status: 'generate';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
  }
  | {
    status: 'error';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    message: string;
  }
  | {
    status: 'complete';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
  };

type AgentLocalChatContinuityAdapter = ConversationContinuityAdapter<
  AgentLocalTurnContext,
  AgentLocalCommitTurnResult
> & {
  commitAgentTurnResult: (input: {
    modeId: 'agent-local-chat-v1';
    threadId: string;
    turnId: string;
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
    signal?: AbortSignal;
    imageState?: AgentLocalChatImageState;
  }) => Promise<AgentLocalCommitTurnResult>;
};

export type AgentLocalChatProviderOptions = {
  runtimeAdapter?: AgentLocalChatRuntimeAdapter;
  continuityAdapter?: AgentLocalChatContinuityAdapter;
};

type AgentLocalTextBeatState = {
  beatId: string;
  beatIndex: number;
  projectionMessageId: string;
  text: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function requireProviderMetadata(metadata: Record<string, unknown> | undefined): AgentLocalChatProviderMetadata {
  const record = metadata?.agentLocalChat;
  if (!record || typeof record !== 'object') {
    throw new Error('agent-local-chat-v1 requires metadata.agentLocalChat');
  }
  const nextRecord = record as Record<string, unknown>;
  const agentId = normalizeText(nextRecord.agentId);
  if (!agentId) {
    throw new Error('agent-local-chat-v1 metadata.agentId is required');
  }
  const targetSnapshot = nextRecord.targetSnapshot;
  if (!targetSnapshot || typeof targetSnapshot !== 'object') {
    throw new Error('agent-local-chat-v1 metadata.targetSnapshot is required');
  }
  const reasoningPreference = nextRecord.reasoningPreference === 'on' ? 'on' : 'off';
  return {
    agentId,
    targetSnapshot: targetSnapshot as AgentLocalTargetSnapshot,
    agentResolution: (nextRecord.agentResolution ?? null) as AgentEffectiveCapabilityResolution | null,
    textExecutionSnapshot: (nextRecord.textExecutionSnapshot ?? null) as AISnapshot | null,
    imageExecutionSnapshot: (nextRecord.imageExecutionSnapshot ?? null) as AISnapshot | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
  };
}

function toAbortLikeErrorMessage(error: unknown): string {
  const message = normalizeText(error instanceof Error ? error.message : String(error || ''));
  return message || 'Generation stopped.';
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const name = normalizeText((error as { name?: unknown }).name).toLowerCase();
  const code = normalizeText((error as { code?: unknown }).code).toLowerCase();
  const message = normalizeText(error instanceof Error ? error.message : String(error)).toLowerCase();
  return name === 'aborterror'
    || code === 'aborterror'
    || code === 'aborted'
    || message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled');
}

const AGENT_IMAGE_MARKER_RE = /\[\[IMG:([\s\S]*?)\]\]/giu;
const AGENT_IMAGE_REQUEST_RE = /\b(?:image|picture|photo|illustration|artwork|portrait|wallpaper)\b|(?:图片|图|照片|插画|头像|壁纸)/iu;
const AGENT_IMAGE_VERB_RE = /\b(?:send|show|make|create|generate|draw|render|give)\b|(?:发|给|来|做|生成|画|出|整|弄)/iu;
const AGENT_IMAGE_DIRECT_REQUEST_RE = /\b(?:can you|could you|please|send me|show me|make me|create me|generate me|draw me|render me)\b|(?:给我|帮我|替我|发我|来个|来一|来张|发张|做张|整点|生成张|画张)/iu;
const AGENT_IMAGE_NEGATION_RE = /\b(?:don't|do not|no need to|not now|stop)\b|(?:不要|别|不用|先别|不必|暂时别|别再)/iu;
const AGENT_NSFW_RE = /\b(?:nude|naked|sex|porn|nsfw|explicit)\b|(?:裸体|裸照|色情|成人视频|成人图)/iu;
const AGENT_IMAGE_PLANNER_TIMEOUT_MS = 4_000;

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasNegativeAgentImageRequest(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized || !AGENT_IMAGE_NEGATION_RE.test(normalized)) {
    return false;
  }
  return (
    /(?:不要|别|不用|先别|不必|暂时别).{0,12}(?:发|给|来|做|生成|画|出|整|弄).{0,12}(?:图|图片|照片|插画|头像|壁纸)/iu.test(normalized)
    || /(?:不要|别|不用|先别|不必|暂时别).{0,8}(?:图|图片|照片|插画|头像|壁纸)/iu.test(normalized)
    || /(?:don't|do not|no need to|not now|stop).{0,16}(?:send|show|make|create|generate|draw|render|give).{0,16}(?:image|picture|photo|illustration|artwork|portrait|wallpaper)/iu.test(normalized)
  );
}

function sanitizeExplicitAgentImagePrompt(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/[!?！？]+$/g, '')
      .replace(/^(?:能不能|可以|可不可以|麻烦|请|please\s+)/iu, '')
      .replace(/^(?:给我|帮我|替我|发我)\s*/iu, ''),
  );
}

function parseExplicitAgentImageRequest(text: string): string | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return null;
  }
  if (hasNegativeAgentImageRequest(normalized)) {
    return null;
  }
  if (!AGENT_IMAGE_REQUEST_RE.test(normalized)) {
    return null;
  }
  if (!AGENT_IMAGE_VERB_RE.test(normalized) && !AGENT_IMAGE_DIRECT_REQUEST_RE.test(normalized)) {
    return null;
  }
  return sanitizeExplicitAgentImagePrompt(normalized) || normalized;
}

function parseAgentImageMarker(input: {
  assistantText: string;
  userText: string;
}): { cleanedText: string; prompt: string | null } {
  const source = String(input.assistantText || '');
  let prompt: string | null = null;
  const cleanedText = normalizeWhitespace(source.replace(AGENT_IMAGE_MARKER_RE, (_match, markerPrompt) => {
    const nextPrompt = normalizeWhitespace(String(markerPrompt || ''));
    if (nextPrompt && !prompt) {
      prompt = nextPrompt;
    }
    return '';
  }));
  if (prompt) {
    return { cleanedText, prompt };
  }
  return {
    cleanedText: normalizeWhitespace(source),
    prompt: null,
  };
}

function buildAgentRecentMediaSummary(context: AgentLocalTurnContext): string {
  const now = Date.now();
  const pending = context.recentBeats.some((beat) => beat.modality === 'image' && beat.status !== 'delivered');
  const recentDelivered = [...context.recentBeats]
    .reverse()
    .find((beat) => beat.modality === 'image' && beat.status === 'delivered');
  if (!recentDelivered) {
    return pending ? 'recentImage=none · pending=yes' : 'recentImage=none · pending=no';
  }
  const minutes = Math.max(0, Math.round((now - recentDelivered.createdAtMs) / 60000));
  return `recentImage=${minutes}m · pending=${pending ? 'yes' : 'no'}`;
}

function hasRecentImageCooldown(context: AgentLocalTurnContext): boolean {
  const recentImageBeat = [...context.recentBeats]
    .reverse()
    .find((beat) => beat.modality === 'image' && beat.status === 'delivered');
  if (!recentImageBeat) {
    return false;
  }
  return Date.now() - recentImageBeat.createdAtMs < 10 * 60 * 1000;
}

function isPromptLikelyNsfw(text: string): boolean {
  return AGENT_NSFW_RE.test(normalizeWhitespace(text));
}

function buildAgentImagePlannerPrompt(input: {
  userText: string;
  assistantText: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  context: AgentLocalTurnContext;
}): string {
  return [
    'You are deciding whether an agent reply should also generate an image.',
    'Return strict JSON only.',
    'Choose "image" only when the dialogue strongly implies a visual deliverable or scene enhancement.',
    'Never choose image for simple greetings, plain Q&A, or when the user explicitly asked not to send an image.',
    'If kind="image", provide concrete visual fields instead of generic wording.',
    'Schema: {"kind":"none|image","trigger":"scene-enhancement|assistant-offer|none","confidence":0,"subject":"string","scene":"string","styleIntent":"string","mood":"string","negativeCues":["string"],"continuityRefs":["string"],"reason":"string","nsfwIntent":"none|suggested"}',
    `Target: ${stringifyJson({
      displayName: input.targetSnapshot.displayName,
      handle: input.targetSnapshot.handle,
      worldName: input.targetSnapshot.worldName,
      bio: input.targetSnapshot.bio,
      ownershipType: input.targetSnapshot.ownershipType,
    })}`,
    `RecentContinuity: ${buildContinuitySummary(input.context)}`,
    `RecentMedia: ${buildAgentRecentMediaSummary(input.context)}`,
    `User: ${input.userText || '-'}`,
    `Assistant: ${input.assistantText || '-'}`,
  ].join('\n');
}

function parseAgentImagePlannerDecision(text: string): {
  kind: 'none' | 'image';
  trigger: 'scene-enhancement' | 'assistant-offer' | 'none';
  subject: string;
  scene: string;
  styleIntent: string;
  mood: string;
  negativeCues: string[];
  continuityRefs: string[];
  reason: string;
  confidence: number;
  nsfwIntent: 'none' | 'suggested';
} {
  const normalized = normalizeText(text);
  const parsed = JSON.parse(normalized) as Record<string, unknown>;
  const kind = normalizeText(parsed.kind);
  if (kind !== 'none' && kind !== 'image') {
    throw new Error('AGENT_IMAGE_PLANNER_INVALID_KIND');
  }
  const trigger = normalizeText(parsed.trigger);
  const negativeCues = Array.isArray(parsed.negativeCues)
    ? parsed.negativeCues.map((value) => normalizeWhitespace(String(value || ''))).filter(Boolean)
    : [];
  const continuityRefs = Array.isArray(parsed.continuityRefs)
    ? parsed.continuityRefs.map((value) => normalizeWhitespace(String(value || ''))).filter(Boolean)
    : [];
  return {
    kind,
    trigger: trigger === 'assistant-offer' || trigger === 'scene-enhancement' ? trigger : 'none',
    subject: normalizeWhitespace(String(parsed.subject || '')),
    scene: normalizeWhitespace(String(parsed.scene || '')),
    styleIntent: normalizeWhitespace(String(parsed.styleIntent || '')),
    mood: normalizeWhitespace(String(parsed.mood || '')),
    negativeCues,
    continuityRefs,
    reason: normalizeWhitespace(String(parsed.reason || '')),
    confidence: Number(parsed.confidence || 0),
    nsfwIntent: normalizeText(parsed.nsfwIntent) === 'suggested' ? 'suggested' : 'none',
  };
}

function compileAgentPlannerImagePrompt(input: {
  subject: string;
  scene: string;
  styleIntent: string;
  mood: string;
  negativeCues: string[];
  continuityRefs: string[];
}): string {
  const lines = [
    input.subject ? `subject: ${input.subject}` : '',
    input.scene ? `scene: ${input.scene}` : '',
    input.styleIntent ? `style: ${input.styleIntent}` : '',
    input.mood ? `mood: ${input.mood}` : '',
    input.continuityRefs.length > 0 ? `continuity: ${input.continuityRefs.join(', ')}` : '',
    input.negativeCues.length > 0 ? `avoid: ${input.negativeCues.join(', ')}` : '',
  ].filter(Boolean);
  return normalizeWhitespace(lines.join('\n'));
}

async function decideAgentImageState(input: {
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  agentId: string;
  threadId: string;
  turnId: string;
  userText: string;
  assistantText: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  context: AgentLocalTurnContext;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  imageExecutionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
}): Promise<AgentLocalChatImageState> {
  const cleanedAssistant = parseAgentImageMarker({
    assistantText: input.assistantText,
    userText: input.userText,
  });
  if (hasNegativeAgentImageRequest(input.userText)) {
    return { status: 'none' };
  }
  const explicitPrompt = parseExplicitAgentImageRequest(input.userText);
  const requestedPrompt = cleanedAssistant.prompt || explicitPrompt;
  const imageProjection = input.agentResolution?.imageProjection || null;
  const imageReady = input.agentResolution?.imageReady === true;

  const blockedMessage = !imageProjection?.selectedBinding
    ? 'Image generation is unavailable because no image route is configured.'
    : 'Image generation is unavailable because the image runtime is not ready.';

  if (requestedPrompt) {
    if (!imageReady || !input.imageExecutionSnapshot) {
      return {
        status: 'error',
        beatId: `${input.turnId}:beat:1`,
        beatIndex: 1,
        projectionMessageId: `${input.turnId}:message:1`,
        prompt: requestedPrompt,
        message: blockedMessage,
      };
    }
    if (isPromptLikelyNsfw(requestedPrompt)) {
      return {
        status: 'error',
        beatId: `${input.turnId}:beat:1`,
        beatIndex: 1,
        projectionMessageId: `${input.turnId}:message:1`,
        prompt: requestedPrompt,
        message: 'Image generation was blocked by the current safety policy.',
      };
    }
    return {
      status: 'generate',
      beatId: `${input.turnId}:beat:1`,
      beatIndex: 1,
      projectionMessageId: `${input.turnId}:message:1`,
      prompt: requestedPrompt,
    };
  }

  if (!imageReady || !input.imageExecutionSnapshot || hasRecentImageCooldown(input.context)) {
    return { status: 'none' };
  }

  const plannerController = new AbortController();
  const plannerTimer = globalThis.setTimeout(() => plannerController.abort(), AGENT_IMAGE_PLANNER_TIMEOUT_MS);
  try {
    const plannerResult = await input.runtimeAdapter.invokeText({
      agentId: input.agentId,
      prompt: buildAgentImagePlannerPrompt({
        userText: input.userText,
        assistantText: cleanedAssistant.cleanedText,
        targetSnapshot: input.targetSnapshot,
        context: input.context,
      }),
      threadId: input.threadId,
      agentResolution: input.agentResolution,
      textExecutionSnapshot: input.textExecutionSnapshot,
      runtimeConfigState: input.runtimeConfigState,
      runtimeFields: input.runtimeFields,
      reasoningPreference: input.reasoningPreference,
      signal: plannerController.signal,
    });
    const decision = parseAgentImagePlannerDecision(plannerResult.text);
    const compiledPrompt = compileAgentPlannerImagePrompt({
      subject: decision.subject,
      scene: decision.scene,
      styleIntent: decision.styleIntent,
      mood: decision.mood,
      negativeCues: decision.negativeCues,
      continuityRefs: decision.continuityRefs,
    });
    if (decision.kind !== 'image' || !compiledPrompt || decision.confidence < 0.82) {
      return { status: 'none' };
    }
    if (decision.nsfwIntent === 'suggested' || isPromptLikelyNsfw(compiledPrompt)) {
      return {
        status: 'error',
        beatId: `${input.turnId}:beat:1`,
        beatIndex: 1,
        projectionMessageId: `${input.turnId}:message:1`,
        prompt: compiledPrompt,
        message: 'Image generation was blocked by the current safety policy.',
      };
    }
    return {
      status: 'generate',
      beatId: `${input.turnId}:beat:1`,
      beatIndex: 1,
      projectionMessageId: `${input.turnId}:message:1`,
      prompt: compiledPrompt,
    };
  } catch {
    return { status: 'none' };
  } finally {
    globalThis.clearTimeout(plannerTimer);
  }
}

function formatHistoryLine(message: ConversationTurnHistoryMessage): string {
  const speaker = message.role === 'assistant'
    ? 'Assistant'
    : message.role === 'user'
      ? 'User'
      : message.role === 'system'
        ? 'Preset'
        : 'Tool';
  return `${speaker}: ${message.text}`;
}

function buildContinuitySummary(context: AgentLocalTurnContext): string {
  return stringifyJson({
    interactionSnapshot: context.interactionSnapshot
      ? {
        version: context.interactionSnapshot.version,
        relationshipState: context.interactionSnapshot.relationshipState,
        emotionalTemperature: context.interactionSnapshot.emotionalTemperature,
        assistantCommitments: context.interactionSnapshot.assistantCommitmentsJson,
        userPrefs: context.interactionSnapshot.userPrefsJson,
        openLoops: context.interactionSnapshot.openLoopsJson,
      }
      : null,
    relationMemorySlots: context.relationMemorySlots.map((slot) => ({
      slotType: slot.slotType,
      summary: slot.summary,
      score: slot.score,
    })),
    recallEntries: context.recallEntries.map((entry) => ({
      summary: entry.summary,
      searchText: entry.searchText,
    })),
    recentTurns: context.recentTurns.map((turn) => ({
      role: turn.role,
      status: turn.status,
      startedAtMs: turn.startedAtMs,
      completedAtMs: turn.completedAtMs,
      abortedAtMs: turn.abortedAtMs,
    })),
    recentBeats: context.recentBeats.map((beat) => ({
      beatIndex: beat.beatIndex,
      modality: beat.modality,
      status: beat.status,
      textShadow: beat.textShadow,
    })),
  });
}

export function buildAgentLocalChatPrompt(input: {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  history: readonly ConversationTurnHistoryMessage[];
  userText: string;
  context: AgentLocalTurnContext;
}): string {
  const transcript = input.history
    .filter((message) => message.role !== 'system' && normalizeText(message.text))
    .map((message) => formatHistoryLine(message))
    .join('\n');
  const sections = [
    input.systemPrompt ? `Preset:\n${input.systemPrompt}` : null,
    `Target:\n${stringifyJson({
      agentId: input.targetSnapshot.agentId,
      displayName: input.targetSnapshot.displayName,
      handle: input.targetSnapshot.handle,
      bio: input.targetSnapshot.bio,
      worldId: input.targetSnapshot.worldId,
      worldName: input.targetSnapshot.worldName,
      ownershipType: input.targetSnapshot.ownershipType,
    })}`,
    `Continuity:\n${buildContinuitySummary(input.context)}`,
    transcript ? `Transcript:\n${transcript}` : null,
    `UserMessage:\nUser: ${input.userText}`,
    buildDesktopChatOutputContractSection(),
    'Instruction:\nReply as the target agent. Use continuity as background truth. Keep internal planning private.',
  ].filter(Boolean);
  return sections.join('\n\n');
}

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: normalizeAgentLocalRuntimeStream(result.stream, result.promptTraceId),
      };
    },
    async invokeText(request) {
      return invokeChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
    },
    async generateImage(request) {
      return generateChatAgentImageRuntime(request);
    },
  };
}

async function* normalizeAgentLocalRuntimeStream(
  stream: AsyncIterable<Awaited<ReturnType<typeof streamChatAgentRuntime>>['stream'] extends AsyncIterable<infer T> ? T : never>,
  promptTraceId: string,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  for await (const part of stream) {
    const normalizedPart = normalizeConversationRuntimeTextStreamPart(part);
    switch (normalizedPart.type) {
      case 'finish':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      case 'error':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      default:
        yield normalizedPart;
    }
  }
}

export function createAgentLocalChatContinuityAdapter(
  options: {
    storeClient?: AgentLocalChatStoreClient;
    now?: () => number;
  } = {},
): AgentLocalChatContinuityAdapter {
  const storeClient = options.storeClient ?? chatAgentStoreClient;
  const now = options.now ?? (() => Date.now());
  const commitAgentTurnResultInternal: AgentLocalChatContinuityAdapter['commitAgentTurnResult'] = async (input) => {
    const context = await storeClient.loadTurnContext({
      threadId: input.threadId,
    });
    const committedAtMs = now();
    const thread = context.thread;
    const textBeat = resolveTextBeatState(input.events, input.turnId);
    const imageState = input.imageState || { status: 'none' as const };
    const projectionMessages = [
      ...(textBeat ? [buildTextProjectionMessage(thread, textBeat, input, committedAtMs)] : []),
      ...((imageState.status === 'complete' || imageState.status === 'error')
        ? [buildImageProjectionMessage(thread, imageState, committedAtMs)]
        : []),
    ];
    return storeClient.commitTurnResult({
      threadId: input.threadId,
      turn: {
        id: input.turnId,
        threadId: input.threadId,
        role: 'assistant',
        status: mapOutcomeToTurnStatus(input.outcome),
        providerMode: 'agent-local-chat-v1',
        traceId: resolveTerminalTraceId(input.events),
        promptTraceId: resolveTerminalPromptTraceId(input.events),
        startedAtMs: committedAtMs,
        completedAtMs: input.outcome === 'completed' ? committedAtMs : null,
        abortedAtMs: input.outcome === 'canceled' ? committedAtMs : null,
      },
      beats: [
        ...(textBeat
          ? [{
            id: textBeat.beatId,
            turnId: input.turnId,
            beatIndex: textBeat.beatIndex,
            modality: 'text' as const,
            status: mapOutcomeToBeatStatus(input.outcome),
            textShadow: normalizeText(input.outputText) || textBeat.text || null,
            artifactId: null,
            mimeType: 'text/plain',
            mediaUrl: null,
            projectionMessageId: textBeat.projectionMessageId,
            createdAtMs: committedAtMs,
            deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
          }]
          : []),
        ...(imageState.status === 'none' || imageState.status === 'generate'
          ? []
          : [{
            id: imageState.beatId,
            turnId: input.turnId,
            beatIndex: imageState.beatIndex,
            modality: 'image' as const,
            status: imageState.status === 'complete' ? 'delivered' as const : 'failed' as const,
            textShadow: imageState.prompt || null,
            artifactId: imageState.status === 'complete' ? imageState.artifactId : null,
            mimeType: imageState.status === 'complete' ? imageState.mimeType : null,
            mediaUrl: imageState.status === 'complete' ? imageState.mediaUrl : null,
            projectionMessageId: imageState.projectionMessageId,
            createdAtMs: committedAtMs,
            deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
          }]),
      ],
      interactionSnapshot: null,
      relationMemorySlots: [],
      recallEntries: [],
      projection: {
        thread: {
          id: thread.id,
          title: thread.title,
          updatedAtMs: committedAtMs,
          lastMessageAtMs: projectionMessages.length > 0 ? committedAtMs : thread.lastMessageAtMs,
          archivedAtMs: thread.archivedAtMs,
          targetSnapshot: thread.targetSnapshot,
        },
        messages: projectionMessages,
        draft: null,
        clearDraft: input.outcome === 'completed',
      },
    });
  };
  return {
    loadTurnContext: async (input) => storeClient.loadTurnContext({
      threadId: input.threadId,
    }),
    commitTurnResult: async (input) => commitAgentTurnResultInternal({
      ...input,
      modeId: 'agent-local-chat-v1',
      imageState: { status: 'none' },
    }),
    commitAgentTurnResult: commitAgentTurnResultInternal,
    cancelTurn: async (input) => {
      await storeClient.cancelTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        scope: input.scope,
        abortedAtMs: now(),
      });
    },
    rebuildProjection: async (threadId) => {
      const result = await storeClient.rebuildProjection(threadId);
      return {
        threadId,
        projectionVersion: result.projectionVersion,
      } satisfies ConversationProjectionRebuildResult;
    },
  };
}

function resolveTextBeatState(
  events: readonly ConversationTurnEvent[],
  turnId: string,
): AgentLocalTextBeatState | null {
  const plannedTextBeats = events.filter((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-planned' }> => (
    event.type === 'beat-planned'
      && event.turnId === turnId
      && event.modality === 'text'
  ));
  if (plannedTextBeats.length === 0) {
    return null;
  }
  if (plannedTextBeats.length !== 1) {
    throw new Error('agent-local-chat-v1 commit only supports one text beat per turn');
  }
  const plannedBeat = plannedTextBeats[0]!;
  const sealedBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'first-beat-sealed' }> => (
    event.type === 'first-beat-sealed'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  const deliveredBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-delivered' }> => (
    event.type === 'beat-delivered'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  return {
    beatId: plannedBeat.beatId,
    beatIndex: plannedBeat.beatIndex,
    projectionMessageId: deliveredBeat?.projectionMessageId || `${turnId}:message:${plannedBeat.beatIndex}`,
    text: sealedBeat?.text || '',
  };
}

function mapOutcomeToTurnStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'completed' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported turn outcome: ${String(outcome)}`);
  }
}

function mapOutcomeToBeatStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'delivered' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported beat outcome: ${String(outcome)}`);
  }
}

function resolveTerminalTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.traceId) || null;
    }
  }
  return null;
}

function resolveTerminalPromptTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.promptTraceId) || null;
    }
  }
  return null;
}

function buildTextProjectionMessage(
  thread: AgentLocalThreadRecord,
  textBeat: AgentLocalTextBeatState,
  input: {
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
  },
  committedAtMs: number,
) {
  const error = input.outcome === 'completed'
    ? null
    : {
      code: input.outcome === 'canceled'
        ? 'OPERATION_ABORTED'
        : normalizeText(input.error?.code) || 'AGENT_TURN_FAILED',
      message: input.outcome === 'canceled'
        ? 'Generation stopped.'
        : normalizeText(input.error?.message) || 'Agent response failed',
    };
  return {
    id: textBeat.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: input.outcome === 'completed' ? 'complete' as const : 'error' as const,
    kind: 'text' as const,
    contentText: normalizeText(input.outputText) || textBeat.text,
    reasoningText: null,
    error,
    traceId: resolveTerminalTraceId(input.events),
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
}

function buildImageProjectionMessage(
  thread: AgentLocalThreadRecord,
  imageState: Extract<AgentLocalChatImageState, { status: 'complete' | 'error' }>,
  committedAtMs: number,
) {
  return {
    id: imageState.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: imageState.status === 'complete' ? 'complete' as const : 'error' as const,
    kind: 'image' as const,
    contentText: imageState.prompt,
    reasoningText: null,
    error: imageState.status === 'complete'
      ? null
      : {
        code: 'AGENT_IMAGE_FAILED',
        message: imageState.message,
      },
    traceId: null,
    parentMessageId: null,
    mediaUrl: imageState.status === 'complete' ? imageState.mediaUrl : null,
    mediaMimeType: imageState.status === 'complete' ? imageState.mimeType : null,
    artifactId: imageState.status === 'complete' ? imageState.artifactId : null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
}

async function commitProviderOutcome(input: {
  continuityAdapter: AgentLocalChatContinuityAdapter;
  baseInput: ConversationTurnInput;
  emittedEvents: readonly ConversationTurnEvent[];
  terminalEvent: ConversationTurnEvent;
  outcome: 'completed' | 'failed' | 'canceled';
  outputText: string;
  reasoningText: string;
  error?: ConversationTurnError;
  imageState?: AgentLocalChatImageState;
}): Promise<AgentLocalCommitTurnResult> {
  return input.continuityAdapter.commitAgentTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: input.baseInput.threadId,
    turnId: input.baseInput.turnId,
    outcome: input.outcome,
    outputText: input.outputText || undefined,
    reasoningText: input.reasoningText || undefined,
    error: input.error,
    events: [
      ...input.emittedEvents,
      input.terminalEvent,
    ],
    signal: input.baseInput.signal,
    imageState: input.imageState,
  });
}

export function createAgentLocalChatConversationProvider(
  options: AgentLocalChatProviderOptions = {},
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? createAgentLocalChatConversationRuntimeAdapter();
  const continuityAdapter = options.continuityAdapter ?? createAgentLocalChatContinuityAdapter();
  return {
    modeId: 'agent-local-chat-v1',
    capabilities: AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const metadata = requireProviderMetadata(input.metadata);
      const userText = normalizeText(input.userMessage.text);
      if (!userText) {
        throw new Error('agent-local-chat-v1 requires a non-empty user message');
      }

      const turnContext = await continuityAdapter.loadTurnContext({
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
        signal: input.signal,
      });
      const prompt = buildAgentLocalChatPrompt({
        systemPrompt: normalizeText(input.systemPrompt) || null,
        targetSnapshot: metadata.targetSnapshot,
        history: input.history,
        userText,
        context: turnContext,
      });

      const emittedEvents: ConversationTurnEvent[] = [];
      const turnStarted: ConversationTurnEvent = {
        type: 'turn-started',
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
      };
      emittedEvents.push(turnStarted);
      yield turnStarted;

      let outputText = '';
      let reasoningText = '';
      let textBeatEmitted = false;
      let terminalEventEmitted = false;
      const beatId = `${input.turnId}:beat:0`;
      const projectionMessageId = `${input.turnId}:message:0`;

      const emitFirstBeat = async function* () {
        if (textBeatEmitted || !outputText) {
          return;
        }
        const plannedEvent: ConversationTurnEvent = {
          type: 'beat-planned',
          turnId: input.turnId,
          beatId,
          beatIndex: 0,
          modality: 'text',
        };
        emittedEvents.push(plannedEvent);
        yield plannedEvent;

        const sealedEvent: ConversationTurnEvent = {
          type: 'first-beat-sealed',
          turnId: input.turnId,
          beatId,
          text: outputText,
        };
        emittedEvents.push(sealedEvent);
        yield sealedEvent;
        textBeatEmitted = true;
      };

      try {
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          prompt,
          threadId: input.threadId,
          agentResolution: metadata.agentResolution,
          textExecutionSnapshot: metadata.textExecutionSnapshot,
          runtimeConfigState: metadata.runtimeConfigState,
          runtimeFields: metadata.runtimeFields,
          reasoningPreference: metadata.reasoningPreference,
          signal: input.signal,
        });

        for await (const part of runtimeResult.stream) {
          switch (part.type) {
            case 'start':
              break;
            case 'reasoning-delta': {
              reasoningText += part.textDelta;
              const reasoningEvent: ConversationTurnEvent = {
                type: 'reasoning-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              emittedEvents.push(reasoningEvent);
              yield reasoningEvent;
              break;
            }
            case 'text-delta': {
              outputText += part.textDelta;
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              const textEvent: ConversationTurnEvent = {
                type: 'text-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              emittedEvents.push(textEvent);
              yield textEvent;
              break;
            }
            case 'finish': {
              if (!normalizeText(outputText)) {
                throw new Error('agent-local-chat-v1 runtime stream completed without output text');
              }
              const cleanedAssistant = parseAgentImageMarker({
                assistantText: outputText,
                userText,
              });
              outputText = cleanedAssistant.cleanedText || outputText;
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              if (textBeatEmitted) {
                const deliveredEvent: ConversationTurnEvent = {
                  type: 'beat-delivered',
                  turnId: input.turnId,
                  beatId,
                  projectionMessageId,
                };
                emittedEvents.push(deliveredEvent);
                yield deliveredEvent;
              }
              let imageState: AgentLocalChatImageState = { status: 'none' };
              const imageDecision = await decideAgentImageState({
                runtimeAdapter,
                agentId: metadata.agentId,
                threadId: input.threadId,
                turnId: input.turnId,
                userText,
                assistantText: outputText,
                targetSnapshot: metadata.targetSnapshot,
                context: turnContext,
                agentResolution: metadata.agentResolution,
                textExecutionSnapshot: metadata.textExecutionSnapshot,
                imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                runtimeConfigState: metadata.runtimeConfigState,
                runtimeFields: metadata.runtimeFields,
                reasoningPreference: metadata.reasoningPreference,
                signal: input.signal,
              });
              if (imageDecision.status !== 'none') {
                const imagePlannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: imageDecision.beatId,
                  beatIndex: imageDecision.beatIndex,
                  modality: 'image',
                };
                emittedEvents.push(imagePlannedEvent);
                yield imagePlannedEvent;

                if (imageDecision.status === 'generate') {
                  const imageDeliveryStarted: ConversationTurnEvent = {
                    type: 'beat-delivery-started',
                    turnId: input.turnId,
                    beatId: `${input.turnId}:beat:1`,
                  };
                  emittedEvents.push(imageDeliveryStarted);
                  yield imageDeliveryStarted;
                  try {
                    const generatedImage = await runtimeAdapter.generateImage({
                      prompt: imageDecision.prompt,
                      imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                      signal: input.signal,
                    });
                    imageState = {
                      status: 'complete',
                      beatId: `${input.turnId}:beat:1`,
                      beatIndex: 1,
                      projectionMessageId: `${input.turnId}:message:1`,
                      prompt: imageDecision.prompt,
                      mediaUrl: generatedImage.mediaUrl,
                      mimeType: generatedImage.mimeType,
                      artifactId: generatedImage.artifactId,
                    };
                    const artifactReadyEvent: ConversationTurnEvent = {
                      type: 'artifact-ready',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      artifactId: imageState.artifactId || imageState.projectionMessageId,
                      mimeType: imageState.mimeType,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(artifactReadyEvent);
                    yield artifactReadyEvent;
                    const imageDeliveredEvent: ConversationTurnEvent = {
                      type: 'beat-delivered',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(imageDeliveredEvent);
                    yield imageDeliveredEvent;
                  } catch (imageError) {
                    imageState = {
                      status: 'error',
                      beatId: `${input.turnId}:beat:1`,
                      beatIndex: 1,
                      projectionMessageId: `${input.turnId}:message:1`,
                      prompt: imageDecision.prompt,
                      message: toChatAgentRuntimeError(imageError).message,
                    };
                  }
                } else {
                  imageState = imageDecision;
                }
              }
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-completed',
                turnId: input.turnId,
                outputText,
                reasoningText: reasoningText || undefined,
                finishReason: part.finishReason,
                usage: part.usage,
                trace: part.trace,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'completed',
                outputText,
                reasoningText,
                imageState,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              yield terminalEvent;
              return;
            }
            case 'error': {
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-failed',
                turnId: input.turnId,
                error: part.error,
                outputText: outputText || undefined,
                reasoningText: reasoningText || undefined,
                trace: part.trace,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'failed',
                outputText,
                reasoningText,
                error: part.error,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              terminalEventEmitted = true;
              yield terminalEvent;
              return;
            }
            default:
              throw new Error(`Unsupported agent-local-chat-v1 runtime part: ${JSON.stringify(part)}`);
          }
        }
        if (!terminalEventEmitted) {
          throw new Error('agent-local-chat-v1 runtime stream ended without a terminal event');
        }
      } catch (error) {
        if (isAbortLikeError(error) || input.signal?.aborted) {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: textBeatEmitted ? 'tail' : 'turn',
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter,
            baseInput: input,
            emittedEvents,
            terminalEvent,
            outcome: 'canceled',
            outputText,
            reasoningText,
            error: {
              code: 'OPERATION_ABORTED',
              message: toAbortLikeErrorMessage(error),
            },
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.threadId,
            projectionVersion: commitResult.projectionVersion,
          };
          yield terminalEvent;
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error);
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-failed',
          turnId: input.turnId,
          error: runtimeError,
          outputText: outputText || undefined,
          reasoningText: reasoningText || undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter,
          baseInput: input,
          emittedEvents,
          terminalEvent,
          outcome: 'failed',
          outputText,
          reasoningText,
          error: runtimeError,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.threadId,
          projectionVersion: commitResult.projectionVersion,
        };
        yield terminalEvent;
      }
    },
  };
}
