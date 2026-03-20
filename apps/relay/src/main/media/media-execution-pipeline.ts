// Relay media execution pipeline — adapted from local-chat media-execution-pipeline.ts
// Removed: React Dispatch/SetStateAction, mod SDK imports (emitLocalChatLog, data layer)
// Adapted: callback-based setMessages/setSessions, relay types, console logging

import type {
  ChatMessage,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatTarget,
  LocalChatTurnAudit,
  MediaExecutionDecision,
  MediaPromptTracePatch,
  MediaRouteSource,
} from '../chat-pipeline/types.js';
import type { LocalChatDefaultSettings } from '../settings/types.js';
import {
  getLocalChatCachedMediaAsset,
  upsertLocalChatMediaAssetRecord,
} from '../session-store/index.js';
import {
  buildMediaArtifactShadow,
  createMediaExecutionCacheKey,
} from './media-spec.js';
import { commitAssistantMessage } from '../chat-pipeline/session-persist.js';
import type { LocalChatTurnAiClient } from '../chat-pipeline/types.js';

export type ExecuteMediaDecisionInput = {
  decision: MediaExecutionDecision;
  aiClient: LocalChatTurnAiClient;
  defaultSettings: LocalChatDefaultSettings;
  nsfwPolicy: 'disabled' | 'local-only' | 'allowed';
  sessionId: string;
  target: LocalChatTarget;
  targetId: string;
  viewerId: string;
  assistantTurnId: string;
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setSessions: (sessions: LocalChatSession[]) => void;
  promptTrace?: LocalChatPromptTrace | null;
  turnAudit?: LocalChatTurnAudit | null;
  messageMeta?: ChatMessage['meta'];
  sendContextKey: string;
  getCurrentContextKey: () => string;
};

function createExecutionTracePatch(input: {
  status: 'ready' | 'failed' | 'blocked';
  routeSource?: MediaRouteSource | null;
  routeModel?: string | null;
  reason?: string | null;
  specHash?: string | null;
  compilerRevision?: string | null;
  resolvedBy?: MediaPromptTracePatch['mediaRouteResolvedBy'];
  cacheStatus?: MediaPromptTracePatch['mediaCacheStatus'];
  shadowText?: string | null;
}): Partial<MediaPromptTracePatch> {
  return {
    mediaExecutionStatus: input.status,
    mediaExecutionRouteSource: input.routeSource || null,
    mediaExecutionRouteModel: input.routeModel || null,
    mediaExecutionReason: input.reason || null,
    mediaSpecHash: input.specHash || null,
    mediaCompilerRevision: input.compilerRevision || null,
    mediaRouteResolvedBy: input.resolvedBy || null,
    mediaCacheStatus: input.cacheStatus || null,
    mediaShadowText: input.shadowText || null,
  };
}

function createPendingMediaMessage(input: {
  intent: MediaExecutionDecision & { kind: 'execute' | 'blocked' };
  messageMeta?: ChatMessage['meta'];
}): ChatMessage {
  const intent = input.intent.kind === 'execute' ? input.intent.intent : input.intent.intent;
  return {
    id: intent.pendingMessageId,
    role: 'assistant',
    kind: intent.type === 'video' ? 'video-pending' : 'image-pending',
    content: '',
    timestamp: new Date(),
    meta: {
      ...(input.messageMeta || {}),
      mediaType: intent.type,
      mediaPrompt: intent.prompt,
      mediaStatus: 'pending',
      mediaIntentSource: intent.source,
      mediaPlannerTrigger: intent.plannerTrigger,
    },
  };
}

function createReadyMediaMessage(input: {
  intent: { type: 'image' | 'video'; pendingMessageId: string; prompt: string; source: string; plannerTrigger: string };
  uri: string;
  mimeType: string;
  messageMeta?: ChatMessage['meta'];
  shadow: ReturnType<typeof buildMediaArtifactShadow>;
  routeSource: string;
  routeModel?: string;
}): ChatMessage {
  return {
    id: input.intent.pendingMessageId,
    role: 'assistant',
    kind: input.intent.type,
    content: '',
    timestamp: new Date(),
    media: {
      uri: input.uri,
      mimeType: input.mimeType,
    },
    meta: {
      ...(input.messageMeta || {}),
      mediaType: input.intent.type,
      mediaPrompt: input.intent.prompt,
      mediaStatus: 'ready',
      mediaShadow: input.shadow,
      routeSource: input.routeSource as 'local' | 'cloud',
      routeModel: input.routeModel,
    },
  };
}

function createMediaBlockedMessage(input: {
  intent: { type: 'image' | 'video'; pendingMessageId: string; prompt: string; source: string; plannerTrigger: string };
  reason: string;
  messageMeta?: ChatMessage['meta'];
  shadow: ReturnType<typeof buildMediaArtifactShadow>;
}): ChatMessage {
  return {
    id: input.intent.pendingMessageId,
    role: 'assistant',
    kind: 'text',
    content: `[Media blocked] ${input.reason}`,
    timestamp: new Date(),
    meta: {
      ...(input.messageMeta || {}),
      mediaType: input.intent.type,
      mediaPrompt: input.intent.prompt,
      mediaStatus: 'blocked',
      mediaError: input.reason,
      mediaShadow: input.shadow,
    },
  };
}

function createMediaFailureMessage(input: {
  intent: { type: 'image' | 'video'; pendingMessageId: string; prompt: string; source: string; plannerTrigger: string };
  reason: string;
  messageMeta?: ChatMessage['meta'];
  shadow: ReturnType<typeof buildMediaArtifactShadow>;
}): ChatMessage {
  return {
    id: input.intent.pendingMessageId,
    role: 'assistant',
    kind: 'text',
    content: `[Media failed] ${input.reason}`,
    timestamp: new Date(),
    meta: {
      ...(input.messageMeta || {}),
      mediaType: input.intent.type,
      mediaPrompt: input.intent.prompt,
      mediaStatus: 'failed',
      mediaError: input.reason,
      mediaShadow: input.shadow,
    },
  };
}

function requireRenderableMediaArtifact(input: {
  artifact: { uri?: string; base64?: string; mimeType?: string } | null | undefined;
  mediaKind: 'image' | 'video';
  pendingMessageId: string;
  routeSource: MediaRouteSource;
  routeModel?: string;
}): {
  uri: string;
  mimeType: string;
  diagnostics: {
    hasArtifact: boolean;
    hasUri: boolean;
    hasBase64: boolean;
    mimeType: string | null;
  };
} {
  const artifact = input.artifact;
  const diagnostics = {
    hasArtifact: Boolean(artifact),
    hasUri: Boolean(artifact?.uri),
    hasBase64: Boolean(artifact?.base64),
    mimeType: artifact?.mimeType ?? null,
  };
  const mimeType = artifact?.mimeType?.trim() || '';
  if (!artifact) {
    throw new Error(`RELAY_MEDIA_${input.mediaKind.toUpperCase()}_NO_ARTIFACT`);
  }
  if (!mimeType) {
    throw new Error(`RELAY_MEDIA_${input.mediaKind.toUpperCase()}_MISSING_MIME_TYPE`);
  }
  if (artifact.uri) {
    return {
      uri: artifact.uri,
      mimeType,
      diagnostics,
    };
  }
  if (artifact.base64) {
    return {
      uri: `data:${mimeType};base64,${artifact.base64}`,
      mimeType,
      diagnostics,
    };
  }
  throw new Error(`RELAY_MEDIA_${input.mediaKind.toUpperCase()}_NO_URI_OR_BASE64`);
}

export async function executeMediaDecision(input: ExecuteMediaDecisionInput): Promise<Partial<MediaPromptTracePatch> | null> {
  async function recordDeliveredMediaAsset(asset: {
    beatId: string;
    executionCacheKey: string;
    specHash: string;
    kind: 'image' | 'video';
    renderUri: string;
    mimeType: string;
    routeSource: MediaRouteSource;
    connectorId?: string;
    model?: string;
    createdAt: string;
    lastHitAt: string;
  }): Promise<void> {
    await upsertLocalChatMediaAssetRecord({
      id: `media_${asset.beatId}`,
      executionCacheKey: asset.executionCacheKey,
      specHash: asset.specHash,
      kind: asset.kind,
      renderUri: asset.renderUri,
      mimeType: asset.mimeType,
      routeSource: asset.routeSource,
      ...(asset.connectorId ? { connectorId: asset.connectorId } : {}),
      ...(asset.model ? { model: asset.model } : {}),
      createdAt: asset.createdAt,
      lastHitAt: asset.lastHitAt,
      conversationId: input.sessionId,
      turnId: input.assistantTurnId,
      beatId: asset.beatId,
    });
  }

  if (input.decision.kind === 'none') {
    return null;
  }

  if (input.decision.kind === 'blocked') {
    const shadow = buildMediaArtifactShadow({
      spec: input.decision.prepared.spec,
      status: 'blocked',
      routeSource: input.decision.routeSource,
      routeModel: input.decision.resolvedRoute?.model || null,
      assetOrigin: 'generated',
      reason: input.decision.blockedReason,
    });
    await commitAssistantMessage({
      sessionId: input.sessionId,
      targetId: input.targetId,
      viewerId: input.viewerId,
      assistantTurnId: input.assistantTurnId,
      messageId: input.decision.intent.pendingMessageId,
      setMessages: input.setMessages,
      setSessions: input.setSessions,
      promptTrace: input.promptTrace,
      turnAudit: input.turnAudit,
      message: createMediaBlockedMessage({
        intent: input.decision.intent,
        reason: input.decision.blockedReason,
        messageMeta: input.messageMeta,
        shadow,
      }),
    });
    return createExecutionTracePatch({
      status: 'blocked',
      routeSource: input.decision.routeSource,
      routeModel: input.decision.resolvedRoute?.model || null,
      reason: input.decision.blockedReason,
      specHash: input.decision.prepared.specHash,
      compilerRevision: input.decision.prepared.compiled.compilerRevision,
      resolvedBy: input.decision.resolvedRoute?.resolvedBy || null,
      cacheStatus: 'none',
      shadowText: shadow.shadowText,
    });
  }

  // decision.kind === 'execute'
  const { prepared, intent, resolvedRoute } = input.decision;
  const executionCacheKey = await createMediaExecutionCacheKey({
    specHash: prepared.specHash,
    compiled: prepared.compiled,
    spec: prepared.spec,
    resolvedRoute,
    nsfwPolicy: input.nsfwPolicy,
  });
  const cached = await getLocalChatCachedMediaAsset(executionCacheKey);
  if (cached) {
    const shadow = buildMediaArtifactShadow({
      spec: prepared.spec,
      status: 'ready',
      routeSource: cached.routeSource,
      routeModel: cached.model || resolvedRoute.model || null,
      assetOrigin: 'cache-hit',
    });
    await commitAssistantMessage({
      sessionId: input.sessionId,
      targetId: input.targetId,
      viewerId: input.viewerId,
      assistantTurnId: input.assistantTurnId,
      messageId: intent.pendingMessageId,
      setMessages: input.setMessages,
      setSessions: input.setSessions,
      promptTrace: input.promptTrace,
      turnAudit: input.turnAudit,
      message: createReadyMediaMessage({
        intent,
        uri: cached.renderUri,
        mimeType: cached.mimeType,
        messageMeta: input.messageMeta,
        shadow,
        routeSource: cached.routeSource,
        routeModel: cached.model || resolvedRoute.model,
      }),
    });
    await recordDeliveredMediaAsset({
      beatId: intent.pendingMessageId,
      executionCacheKey,
      specHash: prepared.specHash,
      kind: prepared.spec.kind,
      renderUri: cached.renderUri,
      mimeType: cached.mimeType,
      routeSource: cached.routeSource,
      connectorId: cached.connectorId,
      model: cached.model || resolvedRoute.model,
      createdAt: cached.createdAt,
      lastHitAt: new Date().toISOString(),
    });
    return createExecutionTracePatch({
      status: 'ready',
      routeSource: cached.routeSource,
      routeModel: cached.model || resolvedRoute.model || null,
      specHash: prepared.specHash,
      compilerRevision: prepared.compiled.compilerRevision,
      resolvedBy: resolvedRoute.resolvedBy,
      cacheStatus: 'hit',
      shadowText: shadow.shadowText,
    });
  }

  // No cache hit — execute generation via AI client
  input.setMessages((prev) => [...prev, createPendingMediaMessage({
    intent: input.decision as MediaExecutionDecision & { kind: 'execute' },
    messageMeta: input.messageMeta,
  })]);

  console.info('[relay:media-execution] start', {
    pendingMessageId: intent.pendingMessageId,
    mediaKind: prepared.spec.kind,
    intentSource: intent.source,
    plannerTrigger: intent.plannerTrigger,
    routeSource: resolvedRoute.source,
    routeModel: resolvedRoute.model,
  });

  let artifactDiagnostics:
    | {
      hasArtifact: boolean;
      hasUri: boolean;
      hasBase64: boolean;
      mimeType: string | null;
    }
    | undefined;
  try {
    console.info('[relay:media-execution] calling generateMedia...', {
      pendingMessageId: intent.pendingMessageId,
      mediaKind: prepared.spec.kind,
    });
    let result: { uri: string; mimeType: string; routeSource: string; routeModel?: string };
    if (prepared.spec.kind === 'image') {
      const imageResult = await input.aiClient.generateImage({
        prompt: prepared.compiled.runtimePayload.prompt,
        negativePrompt: prepared.compiled.runtimePayload.negativePrompt,
        size: prepared.compiled.runtimePayload.size,
        aspectRatio: prepared.compiled.runtimePayload.aspectRatio,
        quality: prepared.compiled.runtimePayload.quality,
        style: prepared.compiled.runtimePayload.style,
        n: prepared.compiled.runtimePayload.n,
        agentId: input.targetId,
      });
      const artifact = imageResult.artifacts[0];
      const resolvedArtifact = requireRenderableMediaArtifact({
        artifact,
        mediaKind: 'image',
        pendingMessageId: intent.pendingMessageId,
        routeSource: resolvedRoute.source,
        routeModel: resolvedRoute.model,
      });
      artifactDiagnostics = resolvedArtifact.diagnostics;
      result = {
        uri: resolvedArtifact.uri,
        mimeType: resolvedArtifact.mimeType,
        routeSource: resolvedRoute.source,
        routeModel: resolvedRoute.model,
      };
    } else {
      const videoResult = await input.aiClient.generateVideo({
        prompt: prepared.compiled.runtimePayload.prompt,
        durationSeconds: prepared.compiled.runtimePayload.durationSeconds,
        aspectRatio: prepared.compiled.runtimePayload.aspectRatio,
        cameraMotion: prepared.compiled.runtimePayload.cameraMotion,
        agentId: input.targetId,
      });
      const artifact = videoResult.artifacts[0];
      const resolvedArtifact = requireRenderableMediaArtifact({
        artifact,
        mediaKind: 'video',
        pendingMessageId: intent.pendingMessageId,
        routeSource: resolvedRoute.source,
        routeModel: resolvedRoute.model,
      });
      artifactDiagnostics = resolvedArtifact.diagnostics;
      result = {
        uri: resolvedArtifact.uri,
        mimeType: resolvedArtifact.mimeType,
        routeSource: resolvedRoute.source,
        routeModel: resolvedRoute.model,
      };
    }

    if (input.getCurrentContextKey() !== input.sendContextKey) {
      console.warn('[relay:media-execution] context-key mismatch, dropping result', {
        pendingMessageId: intent.pendingMessageId,
        current: input.getCurrentContextKey(),
        expected: input.sendContextKey,
      });
      input.setMessages((prev) => prev.filter((message) => message.id !== intent.pendingMessageId));
      return null;
    }

    console.info('[relay:media-execution] generated', {
      pendingMessageId: intent.pendingMessageId,
      mediaKind: prepared.spec.kind,
      routeSource: result.routeSource,
      routeModel: result.routeModel,
      uriLength: result.uri.length,
    });

    const createdAt = new Date().toISOString();
    const shadow = buildMediaArtifactShadow({
      spec: prepared.spec,
      status: 'ready',
      routeSource: result.routeSource as MediaRouteSource,
      routeModel: result.routeModel || resolvedRoute.model || null,
      assetOrigin: 'generated',
    });
    await commitAssistantMessage({
      sessionId: input.sessionId,
      targetId: input.targetId,
      viewerId: input.viewerId,
      assistantTurnId: input.assistantTurnId,
      messageId: intent.pendingMessageId,
      setMessages: input.setMessages,
      setSessions: input.setSessions,
      promptTrace: input.promptTrace,
      turnAudit: input.turnAudit,
      message: createReadyMediaMessage({
        intent,
        uri: result.uri,
        mimeType: result.mimeType,
        messageMeta: input.messageMeta,
        shadow,
        routeSource: result.routeSource,
        routeModel: result.routeModel,
      }),
    });
    await recordDeliveredMediaAsset({
      beatId: intent.pendingMessageId,
      executionCacheKey,
      specHash: prepared.specHash,
      kind: prepared.spec.kind,
      renderUri: result.uri,
      mimeType: result.mimeType,
      routeSource: result.routeSource as MediaRouteSource,
      connectorId: resolvedRoute.connectorId,
      model: result.routeModel || resolvedRoute.model,
      createdAt,
      lastHitAt: createdAt,
    });
    return createExecutionTracePatch({
      status: 'ready',
      routeSource: result.routeSource as MediaRouteSource,
      routeModel: result.routeModel || resolvedRoute.model || null,
      specHash: prepared.specHash,
      compilerRevision: prepared.compiled.compilerRevision,
      resolvedBy: resolvedRoute.resolvedBy,
      cacheStatus: 'miss',
      shadowText: shadow.shadowText,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error || 'RELAY_MEDIA_EXECUTION_FAILED');
    console.error('[relay:media-execution] failed', {
      pendingMessageId: intent.pendingMessageId,
      mediaKind: prepared.spec.kind,
      routeSource: resolvedRoute.source,
      routeModel: resolvedRoute.model,
      reason,
      artifactDiagnostics,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
    });
    if (input.getCurrentContextKey() !== input.sendContextKey) {
      console.warn('[relay:media-execution] context-key mismatch in error path, dropping', {
        pendingMessageId: intent.pendingMessageId,
        current: input.getCurrentContextKey(),
        expected: input.sendContextKey,
      });
      input.setMessages((prev) => prev.filter((message) => message.id !== intent.pendingMessageId));
      return null;
    }
    const shadow = buildMediaArtifactShadow({
      spec: prepared.spec,
      status: 'failed',
      routeSource: resolvedRoute.source,
      routeModel: resolvedRoute.model || null,
      assetOrigin: 'generated',
      reason,
    });
    await commitAssistantMessage({
      sessionId: input.sessionId,
      targetId: input.targetId,
      viewerId: input.viewerId,
      assistantTurnId: input.assistantTurnId,
      messageId: intent.pendingMessageId,
      setMessages: input.setMessages,
      setSessions: input.setSessions,
      promptTrace: input.promptTrace,
      turnAudit: input.turnAudit,
      message: createMediaFailureMessage({
        intent,
        reason,
        messageMeta: input.messageMeta,
        shadow,
      }),
    });
    return createExecutionTracePatch({
      status: 'failed',
      routeSource: resolvedRoute.source,
      routeModel: resolvedRoute.model || null,
      reason,
      specHash: prepared.specHash,
      compilerRevision: prepared.compiled.compilerRevision,
      resolvedBy: resolvedRoute.resolvedBy,
      cacheStatus: 'miss',
      shadowText: shadow.shadowText,
    });
  }
}
