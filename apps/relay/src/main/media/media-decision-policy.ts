// Relay media decision policy — adapted from local-chat media-decision-policy.ts
// Removed: mod SDK imports (RuntimeRouteBinding, RuntimeRouteOptionsSnapshot, ModRuntimeLocalProfileSnapshot)
// Adapted: relay types, simplified route handling (cloud-only, no local model management)
// Key simplification: relay always uses cloud routing, no local dependency snapshots

import type {
  ChatMessage,
  LocalChatPromptTrace,
  LocalChatResolvedMediaRoute,
  LocalChatTarget,
  LocalChatTurnAiClient,
  MediaDependencyStatus,
  MediaExecutionDecision,
  MediaRouteSource,
  PendingMediaIntent,
  PreparedMediaExecution,
} from '../chat-pipeline/types.js';
import { createDefaultMediaPromptTracePatch } from '../chat-pipeline/types.js';
import type { LocalChatDefaultSettings } from '../settings/types.js';
import type { NsfwMediaPolicy } from './nsfw-media-policy.js';
import { isMediaGenerationAllowed, isPromptLikelyNsfw } from './nsfw-media-policy.js';
import type { ResolvedExperiencePolicy } from '../chat-pipeline/resolved-experience-policy.js';
import { planMediaTurn, type MediaPlannerDecision } from './media-planner.js';
import { buildMediaGenerationSpec, compileMediaExecution, createMediaSpecHash, type MediaIntent } from './media-spec.js';
import { collectMediaContextSnapshot, enrichMediaIntent, type MediaContextSnapshot } from './media-context-enricher.js';
import { isMediaRouteReady, resolveMediaRouteConfig, buildMediaSettingsRevision } from './media-route.js';

type AssistantTurnMediaHistory = {
  timestampMs: number | null;
  hasMedia: boolean;
  hasVideo: boolean;
};

type RecentMediaSummary = {
  autoMediaCooling: boolean;
  autoVideoCooling: boolean;
  hasPendingMedia: boolean;
  summary: string;
};

type IntentGateResult = {
  allowed: true;
  routeSource: MediaRouteSource;
} | {
  allowed: false;
  routeSource: MediaRouteSource;
  blockedReason: string;
};

export type DecideMediaExecutionInput = {
  aiClient: Pick<LocalChatTurnAiClient, 'generateObject'> & Partial<Pick<LocalChatTurnAiClient, 'resolveRoute'>>;
  turnTxnId: string;
  defaultSettings: LocalChatDefaultSettings;
  resolvedPolicy: ResolvedExperiencePolicy;
  userText: string;
  assistantText: string;
  target: LocalChatTarget;
  worldId?: string | null;
  messages: ChatMessage[];
  promptTrace: LocalChatPromptTrace | null;
  nsfwPolicy: NsfwMediaPolicy;
  routeSourceHint: MediaRouteSource;
  markerOverrideIntent: PendingMediaIntent | null;
};

const IMAGE_AUTO_CONFIDENCE_THRESHOLD = 0.82;
const VIDEO_AUTO_CONFIDENCE_THRESHOLD = 0.93;
const AUTO_MEDIA_TURN_COOLDOWN = 6;
const AUTO_MEDIA_TIME_COOLDOWN_MS = 10 * 60 * 1000;
const AUTO_VIDEO_TURN_COOLDOWN = 20;
const AUTO_VIDEO_TIME_COOLDOWN_MS = 30 * 60 * 1000;

const ASSISTANT_OFFER_SIGNAL_RE = /\b(?:i(?:'ll| will)|let me|want me to|i can|here(?:'s| is)|sending)\b|(?:给你看|发你看|发给你|给你发|拍给你|给你拍|我给你看|我发你|我拍给你|给你来一张|给你来段|我这就发|我这就给你)/i;
const VISUAL_SCENE_SIGNAL_RE = /\b(?:frame|portrait|photo|image|light|lighting|color|dress|street|rain|beach|room|window|night|sunset|cinematic|close-up|wide shot|selfie)\b|(?:画面|镜头|样子|神情|表情|穿着|光影|灯光|夜色|海边|房间|窗边|雨夜|照片|图片|身影|背影|颜色|氛围|构图|电影感|特写|远景|自拍)/i;
const VIDEO_MOTION_SIGNAL_RE = /\b(?:walk|turn(?:\s+around)?|move|moving|spin|dance|approach|reach|camera|tracking|follow|pan|zoom|motion|sequence|clip|blink|glance|smile|nod|loop)\b|(?:走|转身|移动|舞动|迈步|靠近|抬手|镜头|跟拍|推进|拉远|动态|片段|过程|眨眼|回眸|微笑|点头|短循环)/i;
const GENERIC_MEDIA_DESCRIPTOR_RE = /^(?:当前对话中的主体|贴合当前对话语境|自然、精致、贴合陪伴式对话|贴合当前交流氛围|自然|普通问候场景|generic greeting|scene fits image|visual scene)$/i;

function resolveConfiguredMediaRouteSource(input: {
  kind: 'image' | 'video';
  settings: LocalChatDefaultSettings;
  routeSourceHint: MediaRouteSource;
}): MediaRouteSource {
  const configured = input.kind === 'image'
    ? input.settings.imageRouteSource
    : input.settings.videoRouteSource;
  if (configured === 'local' || configured === 'cloud') return configured;
  return input.routeSourceHint;
}

function collectAssistantTurnMediaHistory(messages: ChatMessage[]): AssistantTurnMediaHistory[] {
  const turns: AssistantTurnMediaHistory[] = [];
  let current: AssistantTurnMediaHistory | null = null;
  messages.forEach((message) => {
    if (message.role === 'user') {
      current = null;
      return;
    }
    if (!current) {
      current = { timestampMs: null, hasMedia: false, hasVideo: false };
      turns.push(current);
    }
    const timestampMs = message.timestamp instanceof Date
      ? message.timestamp.getTime()
      : new Date(message.timestamp).getTime();
    if (Number.isFinite(timestampMs)) {
      current.timestampMs = Math.max(current.timestampMs || 0, timestampMs);
    }
    if (message.kind === 'image' || message.kind === 'video') {
      current.hasMedia = true;
      if (message.kind === 'video') current.hasVideo = true;
    }
  });
  return turns.reverse();
}

function summarizeRecentMedia(messages: ChatMessage[]): RecentMediaSummary {
  const now = Date.now();
  const pendingMedia = messages.some((m) => m.kind === 'image-pending' || m.kind === 'video-pending');
  const assistantTurns = collectAssistantTurnMediaHistory(messages);
  const lastMediaTurnIndex = assistantTurns.findIndex((t) => t.hasMedia);
  const lastVideoTurnIndex = assistantTurns.findIndex((t) => t.hasVideo);
  const lastMediaTurn = lastMediaTurnIndex >= 0 ? assistantTurns[lastMediaTurnIndex] : null;
  const lastVideoTurn = lastVideoTurnIndex >= 0 ? assistantTurns[lastVideoTurnIndex] : null;
  const turnsSinceLastMedia = lastMediaTurnIndex >= 0 ? lastMediaTurnIndex : null;
  const turnsSinceLastVideo = lastVideoTurnIndex >= 0 ? lastVideoTurnIndex : null;
  const msSinceLastMedia = lastMediaTurn?.timestampMs ? now - lastMediaTurn.timestampMs : null;
  const msSinceLastVideo = lastVideoTurn?.timestampMs ? now - lastVideoTurn.timestampMs : null;
  return {
    autoMediaCooling: (turnsSinceLastMedia !== null && turnsSinceLastMedia < AUTO_MEDIA_TURN_COOLDOWN) || (msSinceLastMedia !== null && msSinceLastMedia < AUTO_MEDIA_TIME_COOLDOWN_MS),
    autoVideoCooling: (turnsSinceLastVideo !== null && turnsSinceLastVideo < AUTO_VIDEO_TURN_COOLDOWN) || (msSinceLastVideo !== null && msSinceLastVideo < AUTO_VIDEO_TIME_COOLDOWN_MS),
    hasPendingMedia: pendingMedia,
    summary: [
      turnsSinceLastMedia === null ? 'recentMedia=none' : `recentMedia=${turnsSinceLastMedia}turn/${Math.max(0, Math.round((msSinceLastMedia || 0) / 60000))}m`,
      turnsSinceLastVideo === null ? 'recentVideo=none' : `recentVideo=${turnsSinceLastVideo}turn/${Math.max(0, Math.round((msSinceLastVideo || 0) / 60000))}m`,
      pendingMedia ? 'pending=yes' : 'pending=no',
    ].join(' · '),
  };
}

function joinMediaSignalText(values: Array<string | undefined | null>): string {
  return values.map((v) => String(v || '').trim()).filter(Boolean).join('\n');
}

function hasAssistantOfferSignal(assistantText: string): boolean {
  return ASSISTANT_OFFER_SIGNAL_RE.test(String(assistantText || '').trim());
}

function hasVisualSceneSignal(input: { userText: string; assistantText: string; decision: MediaPlannerDecision }): boolean {
  const joined = joinMediaSignalText([input.userText, input.assistantText, input.decision.subject, input.decision.scene, input.decision.styleIntent, input.decision.hints?.composition]);
  if (!joined) return false;
  if (VISUAL_SCENE_SIGNAL_RE.test(joined)) return true;
  return [input.decision.subject, input.decision.scene, input.decision.styleIntent, input.assistantText, input.userText]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .filter((v) => !GENERIC_MEDIA_DESCRIPTOR_RE.test(v))
    .some((v) => v.length >= 18);
}

function hasVideoMotionSignal(input: { userText: string; assistantText: string; decision: MediaPlannerDecision }): boolean {
  return VIDEO_MOTION_SIGNAL_RE.test(joinMediaSignalText([input.userText, input.assistantText, input.decision.scene, input.decision.reason, input.decision.hints?.composition]));
}

function evaluateIntentGate(input: {
  intent: PendingMediaIntent;
  defaultSettings: LocalChatDefaultSettings;
  routeSourceHint: MediaRouteSource;
  nsfwPolicy: NsfwMediaPolicy;
  imageRouteReady: boolean;
  videoRouteReady: boolean;
}): IntentGateResult {
  const routeReady = input.intent.type === 'image' ? input.imageRouteReady : input.videoRouteReady;
  const routeSource = resolveConfiguredMediaRouteSource({
    kind: input.intent.type,
    settings: input.defaultSettings,
    routeSourceHint: input.routeSourceHint,
  });
  if (!routeReady) {
    return { allowed: false, routeSource, blockedReason: `${input.intent.type} route not ready` };
  }
  const nsfwAllowed = isMediaGenerationAllowed({
    policy: input.nsfwPolicy,
    routeSource,
    prompt: input.intent.prompt,
    isNsfwPrompt: input.intent.plannerSuggestsNsfw || isPromptLikelyNsfw(input.intent.prompt),
  });
  if (!nsfwAllowed) {
    return { allowed: false, routeSource, blockedReason: `${input.intent.type} blocked by NSFW policy` };
  }
  return { allowed: true, routeSource };
}

function createDecisionPatch(input: Partial<ReturnType<typeof createDefaultMediaPromptTracePatch>>): ReturnType<typeof createDefaultMediaPromptTracePatch> {
  return { ...createDefaultMediaPromptTracePatch(), ...input };
}

function buildSemanticIntentFromPlannerDecision(input: { decision: MediaPlannerDecision }): MediaIntent {
  return {
    kind: input.decision.kind === 'video' ? 'video' : 'image',
    intentSource: 'planner',
    plannerTrigger: input.decision.trigger,
    confidence: input.decision.confidence,
    nsfwIntent: input.decision.nsfwIntent,
    subject: String(input.decision.subject || '').trim(),
    scene: String(input.decision.scene || '').trim(),
    styleIntent: String(input.decision.styleIntent || '').trim(),
    mood: String(input.decision.mood || '').trim(),
    hints: input.decision.hints,
  };
}

function buildSemanticIntentFromPrompt(input: {
  kind: 'image' | 'video';
  source: PendingMediaIntent['source'];
  plannerTrigger: PendingMediaIntent['plannerTrigger'];
  prompt: string;
  confidence?: number;
  nsfwIntent?: 'none' | 'suggested';
}): MediaIntent {
  const normalizedPrompt = String(input.prompt || '').trim();
  return {
    kind: input.kind,
    intentSource: input.source,
    plannerTrigger: input.plannerTrigger,
    confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : null,
    nsfwIntent: input.nsfwIntent || (isPromptLikelyNsfw(normalizedPrompt) ? 'suggested' : 'none'),
    subject: 'subject in current conversation',
    scene: normalizedPrompt || 'fits current conversation context',
    styleIntent: 'natural, refined, companion chat style',
    mood: 'matches current interaction mood',
  };
}

async function prepareMediaExecution(input: {
  semanticIntent: MediaIntent;
  pendingMessageId: string;
  target: LocalChatTarget;
  targetId: string;
  worldId?: string | null;
  userText: string;
  assistantText: string;
  contextSnapshot: MediaContextSnapshot;
}): Promise<{
  intent: PendingMediaIntent;
  prepared: PreparedMediaExecution;
}> {
  const spec = buildMediaGenerationSpec({
    intent: enrichMediaIntent({
      semanticIntent: input.semanticIntent,
      target: input.target,
      userText: input.userText,
      assistantText: input.assistantText,
      contextSnapshot: input.contextSnapshot,
    }),
    targetId: input.targetId,
    worldId: input.worldId,
  });
  const compiled = compileMediaExecution(spec);
  const specHash = await createMediaSpecHash(spec);
  return {
    intent: {
      type: spec.kind,
      prompt: compiled.compiledPromptText,
      source: spec.intentSource,
      plannerTrigger: spec.plannerTrigger,
      ...(Number.isFinite(spec.confidence) ? { plannerConfidence: Number(spec.confidence) } : {}),
      ...(spec.nsfwIntent === 'suggested' ? { plannerSuggestsNsfw: true } : {}),
      pendingMessageId: input.pendingMessageId,
    },
    prepared: { spec, specHash, compiled, pendingMessageId: input.pendingMessageId },
  };
}

async function resolveAuthorityMediaRoute(input: {
  kind: 'image' | 'video';
  defaultSettings: LocalChatDefaultSettings;
  routeSourceHint: MediaRouteSource;
}): Promise<{
  routeSource: MediaRouteSource;
  resolvedRoute: LocalChatResolvedMediaRoute;
} | null> {
  const routeConfig = resolveMediaRouteConfig({
    kind: input.kind,
    settings: input.defaultSettings,
  });
  const routeSource = routeConfig.routeSource === 'auto'
    ? input.routeSourceHint
    : routeConfig.routeSource;
  const binding = routeConfig.routeBinding;
  if (!binding) {
    return null;
  }
  const model = String(routeConfig.model || '').trim();
  if (!model) {
    return null;
  }
  const connectorId = String(binding.connectorId || '').trim();
  const localModelId = String(binding.localModelId || '').trim();
  if (binding.source === 'local' && !localModelId) {
    return null;
  }
  if (binding.source === 'cloud' && !connectorId) {
    return null;
  }
  return {
    routeSource: binding.source,
    resolvedRoute: {
      source: binding.source,
      ...(connectorId ? { connectorId } : {}),
      ...(localModelId ? { localModelId } : {}),
      model: binding.source === 'local' ? `local/${model}` : model,
      resolvedBy: 'selected',
      resolvedAt: new Date().toISOString(),
      settingsRevision: buildMediaSettingsRevision({ kind: input.kind, settings: input.defaultSettings }),
      routeOptionsRevision: 0,
    },
  };
}

export async function decideMediaExecution(input: DecideMediaExecutionInput): Promise<MediaExecutionDecision> {
  const defaultPatch = createDefaultMediaPromptTracePatch();
  const mediaAutonomy = input.resolvedPolicy.mediaPolicy.autonomy;
  if (mediaAutonomy === 'off') {
    return { kind: 'none', promptTracePatch: defaultPatch };
  }

  const imageRouteReady = isMediaRouteReady({ kind: 'image', settings: input.defaultSettings });
  const videoRouteReady = isMediaRouteReady({ kind: 'video', settings: input.defaultSettings });

  // Marker override (from turn plan media request)
  if (input.markerOverrideIntent) {
    const gate = evaluateIntentGate({
      intent: input.markerOverrideIntent,
      defaultSettings: input.defaultSettings,
      routeSourceHint: input.routeSourceHint,
      nsfwPolicy: input.nsfwPolicy,
      imageRouteReady,
      videoRouteReady,
    });
    const contextSnapshot = collectMediaContextSnapshot({
      target: input.target,
      messages: input.messages,
      userText: input.userText,
      assistantText: input.assistantText,
    });
    const semanticIntent = buildSemanticIntentFromPrompt({
      kind: input.markerOverrideIntent.type,
      source: input.markerOverrideIntent.source,
      plannerTrigger: 'marker-override',
      prompt: input.markerOverrideIntent.prompt,
      confidence: input.markerOverrideIntent.plannerConfidence,
      nsfwIntent: input.markerOverrideIntent.plannerSuggestsNsfw ? 'suggested' : 'none',
    });
    const { intent, prepared } = await prepareMediaExecution({
      semanticIntent,
      pendingMessageId: input.markerOverrideIntent.pendingMessageId,
      target: input.target,
      targetId: input.target.id,
      worldId: input.worldId,
      userText: input.userText,
      assistantText: input.assistantText,
      contextSnapshot,
    });
    if (!gate.allowed) {
      return {
        kind: 'blocked',
        intent,
        prepared,
        blockedReason: gate.blockedReason,
        routeSource: gate.routeSource,
        resolvedRoute: null,
        promptTracePatch: createDecisionPatch({
          plannerUsed: true,
          plannerKind: intent.type,
          plannerTrigger: 'marker-override',
          plannerConfidence: intent.plannerConfidence ?? null,
          plannerBlockedReason: gate.blockedReason,
          mediaDecisionSource: intent.source,
          mediaDecisionKind: intent.type,
          mediaExecutionStatus: 'blocked',
          mediaExecutionRouteSource: gate.routeSource,
          mediaExecutionReason: gate.blockedReason,
        }),
      };
    }
    const resolved = await resolveAuthorityMediaRoute({
      kind: intent.type,
      defaultSettings: input.defaultSettings,
      routeSourceHint: input.routeSourceHint,
    });
    if (!resolved) {
      return {
        kind: 'blocked',
        intent,
        prepared,
        blockedReason: 'No media route resolved',
        routeSource: gate.routeSource,
        resolvedRoute: null,
        promptTracePatch: createDecisionPatch({
          plannerUsed: true,
          plannerKind: intent.type,
          plannerTrigger: 'marker-override',
          plannerConfidence: intent.plannerConfidence ?? null,
          plannerBlockedReason: 'No media route resolved',
          mediaDecisionSource: intent.source,
          mediaDecisionKind: intent.type,
          mediaExecutionStatus: 'blocked',
          mediaExecutionRouteSource: gate.routeSource,
          mediaExecutionReason: 'No media route resolved',
        }),
      };
    }
    return {
      kind: 'execute',
      intent,
      prepared,
      resolvedRoute: resolved.resolvedRoute,
      promptTracePatch: createDecisionPatch({
        plannerUsed: true,
        plannerKind: intent.type,
        plannerTrigger: 'marker-override',
        plannerConfidence: intent.plannerConfidence ?? null,
        mediaDecisionSource: intent.source,
        mediaDecisionKind: intent.type,
        mediaExecutionStatus: 'pending',
        mediaExecutionRouteSource: resolved.routeSource,
        mediaExecutionRouteModel: resolved.resolvedRoute.model,
      }),
    };
  }

  // Auto media (planner-based)
  if (mediaAutonomy !== 'natural') {
    return { kind: 'none', promptTracePatch: defaultPatch };
  }
  if (!input.resolvedPolicy.mediaPolicy.allowVisualAuto) {
    return { kind: 'none', promptTracePatch: defaultPatch };
  }
  if (!imageRouteReady && !videoRouteReady) {
    return { kind: 'none', promptTracePatch: defaultPatch };
  }

  const recentMedia = summarizeRecentMedia(input.messages);
  if (recentMedia.hasPendingMedia) {
    return { kind: 'none', promptTracePatch: defaultPatch };
  }

  const contextSnapshot = collectMediaContextSnapshot({
    target: input.target,
    messages: input.messages,
    userText: input.userText,
    assistantText: input.assistantText,
  });

  const plannerResult = await planMediaTurn({
    aiClient: input.aiClient,
    userText: input.userText,
    assistantText: input.assistantText,
    target: input.target,
    worldId: input.worldId,
    nsfwPolicy: input.nsfwPolicy,
    imageReady: imageRouteReady,
    videoReady: videoRouteReady,
    imageDependencyStatus: imageRouteReady ? 'ready' : 'unknown',
    videoDependencyStatus: videoRouteReady ? 'ready' : 'unknown',
    recentMediaSummary: recentMedia.summary,
    promptTrace: input.promptTrace,
    visualAnchorSummary: contextSnapshot.visualAnchorSummary,
    recentTurnSummary: contextSnapshot.recentTurnSummary,
    continuitySummary: contextSnapshot.continuitySummary,
  });

  if (plannerResult.status !== 'ok' || plannerResult.decision.kind === 'none') {
    return {
      kind: 'none',
      promptTracePatch: createDecisionPatch({
        plannerUsed: true,
        plannerKind: 'none',
        plannerTrigger: 'none',
        plannerBlockedReason: plannerResult.status !== 'ok' ? plannerResult.reason : null,
      }),
    };
  }

  const decision = plannerResult.decision;
  const isVideo = decision.kind === 'video';
  const confidenceThreshold = isVideo ? VIDEO_AUTO_CONFIDENCE_THRESHOLD : IMAGE_AUTO_CONFIDENCE_THRESHOLD;
  if (decision.confidence < confidenceThreshold) {
    return {
      kind: 'none',
      promptTracePatch: createDecisionPatch({
        plannerUsed: true,
        plannerKind: decision.kind,
        plannerTrigger: decision.trigger,
        plannerConfidence: decision.confidence,
        plannerBlockedReason: `confidence ${decision.confidence} < threshold ${confidenceThreshold}`,
      }),
    };
  }

  // Cooling check
  if (isVideo && recentMedia.autoVideoCooling) {
    return { kind: 'none', promptTracePatch: createDecisionPatch({ plannerUsed: true, plannerKind: 'video', plannerTrigger: decision.trigger, plannerConfidence: decision.confidence, plannerBlockedReason: 'video-auto-cooling' }) };
  }
  if (!isVideo && recentMedia.autoMediaCooling) {
    return { kind: 'none', promptTracePatch: createDecisionPatch({ plannerUsed: true, plannerKind: 'image', plannerTrigger: decision.trigger, plannerConfidence: decision.confidence, plannerBlockedReason: 'image-auto-cooling' }) };
  }

  // Visual scene signal check for scene-enhancement trigger
  if (decision.trigger === 'scene-enhancement') {
    if (!hasVisualSceneSignal({ userText: input.userText, assistantText: input.assistantText, decision })) {
      return { kind: 'none', promptTracePatch: createDecisionPatch({ plannerUsed: true, plannerKind: decision.kind, plannerTrigger: decision.trigger, plannerConfidence: decision.confidence, plannerBlockedReason: 'no-visual-scene-signal' }) };
    }
  }

  const semanticIntent = buildSemanticIntentFromPlannerDecision({ decision });
  const pendingMessageId = `media_${input.turnTxnId}`;
  const { intent, prepared } = await prepareMediaExecution({
    semanticIntent,
    pendingMessageId,
    target: input.target,
    targetId: input.target.id,
    worldId: input.worldId,
    userText: input.userText,
    assistantText: input.assistantText,
    contextSnapshot,
  });

  const gate = evaluateIntentGate({
    intent,
    defaultSettings: input.defaultSettings,
    routeSourceHint: input.routeSourceHint,
    nsfwPolicy: input.nsfwPolicy,
    imageRouteReady,
    videoRouteReady,
  });

  if (!gate.allowed) {
    return {
      kind: 'blocked',
      intent,
      prepared,
      blockedReason: gate.blockedReason,
      routeSource: gate.routeSource,
      resolvedRoute: null,
      promptTracePatch: createDecisionPatch({
        plannerUsed: true,
        plannerKind: decision.kind,
        plannerTrigger: decision.trigger,
        plannerConfidence: decision.confidence,
        plannerBlockedReason: gate.blockedReason,
        mediaDecisionSource: 'planner',
        mediaDecisionKind: decision.kind,
        mediaExecutionStatus: 'blocked',
        mediaExecutionRouteSource: gate.routeSource,
        mediaExecutionReason: gate.blockedReason,
      }),
    };
  }

  const resolved = await resolveAuthorityMediaRoute({
    kind: intent.type,
    defaultSettings: input.defaultSettings,
    routeSourceHint: input.routeSourceHint,
  });
  if (!resolved) {
    return {
      kind: 'blocked',
      intent,
      prepared,
      blockedReason: 'No media route resolved',
      routeSource: gate.routeSource,
      resolvedRoute: null,
      promptTracePatch: createDecisionPatch({
        plannerUsed: true,
        plannerKind: decision.kind,
        plannerTrigger: decision.trigger,
        plannerConfidence: decision.confidence,
        plannerBlockedReason: 'No media route resolved',
        mediaDecisionSource: 'planner',
        mediaDecisionKind: decision.kind,
        mediaExecutionStatus: 'blocked',
        mediaExecutionRouteSource: gate.routeSource,
        mediaExecutionReason: 'No media route resolved',
      }),
    };
  }

  return {
    kind: 'execute',
    intent,
    prepared,
    resolvedRoute: resolved.resolvedRoute,
    promptTracePatch: createDecisionPatch({
      plannerUsed: true,
      plannerKind: decision.kind,
      plannerTrigger: decision.trigger,
      plannerConfidence: decision.confidence,
      mediaDecisionSource: 'planner',
      mediaDecisionKind: decision.kind,
      mediaExecutionStatus: 'pending',
      mediaExecutionRouteSource: resolved.routeSource,
      mediaExecutionRouteModel: resolved.resolvedRoute.model,
    }),
  };
}
