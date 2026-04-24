import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type { AgentLocalMessageRecord } from '@renderer/bridge/runtime-bridge/types';
import type { AISnapshot } from './conversation-capability';
import {
  pollChatAgentVoiceWorkflowRuntime,
  synthesizeChatAgentVoiceReferenceRuntime,
  type ChatAgentVoiceWorkflowRuntimeDeps,
} from './chat-agent-runtime';
import {
  parseAgentChatVoiceWorkflowMetadata,
  toAgentChatVoiceWorkflowMetadataJson,
} from './chat-agent-voice-workflow';

type VoiceWorkflowTrackerStoreClient = Pick<
  typeof chatAgentStoreClient,
  'updateMessage' | 'updateTurnBeat'
>;

export type AgentChatVoiceWorkflowReconcileResult = {
  updatedMessage: AgentLocalMessageRecord | null;
  stillPending: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function reconcileAgentChatVoiceWorkflowMessage(input: {
  message: AgentLocalMessageRecord;
  activeConversationAnchorId?: string | null;
  voiceExecutionSnapshot: AISnapshot | null;
  runtimeDeps?: ChatAgentVoiceWorkflowRuntimeDeps;
  storeClient?: VoiceWorkflowTrackerStoreClient;
  now?: () => number;
}): Promise<AgentChatVoiceWorkflowReconcileResult> {
  const metadata = parseAgentChatVoiceWorkflowMetadata(input.message.metadataJson);
  if (!metadata) {
    return {
      updatedMessage: null,
      stillPending: false,
    };
  }
  const activeConversationAnchorId = normalizeText(input.activeConversationAnchorId);
  if (activeConversationAnchorId && metadata.conversationAnchorId !== activeConversationAnchorId) {
    return {
      updatedMessage: null,
      stillPending: true,
    };
  }
  const storeClient = input.storeClient ?? chatAgentStoreClient;
  const runtimeDeps = input.runtimeDeps ?? {};
  const now = input.now ?? (() => Date.now());
  const polled = await pollChatAgentVoiceWorkflowRuntime({
    jobId: metadata.jobId,
  }, runtimeDeps);

  if (
    polled.workflowStatus === 'submitted'
    || polled.workflowStatus === 'queued'
    || polled.workflowStatus === 'running'
  ) {
    if (polled.workflowStatus === metadata.workflowStatus && !polled.message) {
      return {
        updatedMessage: null,
        stillPending: true,
      };
    }
    const updatedMetadata = {
      ...metadata,
      workflowStatus: polled.workflowStatus,
      traceId: polled.traceId || metadata.traceId || null,
      message: polled.message || metadata.message || null,
    };
    const updatedMessage = await storeClient.updateMessage({
      id: input.message.id,
      kind: input.message.kind,
      status: 'pending',
      contentText: normalizeText(updatedMetadata.message)
        || normalizeText(input.message.contentText)
        || 'Voice workflow is still running…',
      reasoningText: input.message.reasoningText,
      error: null,
      traceId: updatedMetadata.traceId || null,
      mediaUrl: null,
      mediaMimeType: null,
      artifactId: null,
      metadataJson: toAgentChatVoiceWorkflowMetadataJson(updatedMetadata),
      updatedAtMs: now(),
    });
    return {
      updatedMessage,
      stillPending: true,
    };
  }

  if (polled.workflowStatus === 'complete') {
    const completedMetadata = {
      ...metadata,
      workflowStatus: 'complete' as const,
      traceId: polled.traceId || metadata.traceId || null,
      message: metadata.message || null,
    };
    let updatedMessage: AgentLocalMessageRecord;
    if (completedMetadata.voiceReference && input.voiceExecutionSnapshot) {
      const playback = await synthesizeChatAgentVoiceReferenceRuntime({
        prompt: completedMetadata.playbackPrompt,
        voiceReference: completedMetadata.voiceReference,
        voiceExecutionSnapshot: input.voiceExecutionSnapshot,
      }, runtimeDeps);
      const messageWithPlayback = {
        ...completedMetadata,
        mediaUrl: playback.mediaUrl,
        mediaMimeType: playback.mimeType,
        artifactId: playback.artifactId,
        playbackCueEnvelope: playback.playbackCueEnvelope,
        message: completedMetadata.transcriptText,
      };
      updatedMessage = await storeClient.updateMessage({
        id: input.message.id,
        kind: 'voice',
        status: 'complete',
        contentText: completedMetadata.transcriptText,
        reasoningText: input.message.reasoningText,
        error: null,
        traceId: playback.traceId || completedMetadata.traceId || null,
        mediaUrl: playback.mediaUrl,
        mediaMimeType: playback.mimeType,
        artifactId: playback.artifactId,
        metadataJson: toAgentChatVoiceWorkflowMetadataJson(messageWithPlayback),
        updatedAtMs: now(),
      });
      await storeClient.updateTurnBeat({
        id: completedMetadata.beatId,
        status: 'delivered',
        textShadow: completedMetadata.transcriptText || completedMetadata.playbackPrompt,
        artifactId: playback.artifactId,
        mimeType: playback.mimeType,
        mediaUrl: playback.mediaUrl,
        deliveredAtMs: now(),
      });
    } else if (completedMetadata.voiceReference) {
      const messageText = 'Custom voice is ready, but projected playback is unavailable because no voice route is configured.';
      updatedMessage = await storeClient.updateMessage({
        id: input.message.id,
        kind: 'text',
        status: 'complete',
        contentText: messageText,
        reasoningText: input.message.reasoningText,
        error: null,
        traceId: completedMetadata.traceId || null,
        mediaUrl: null,
        mediaMimeType: null,
        artifactId: null,
        metadataJson: toAgentChatVoiceWorkflowMetadataJson({
          ...completedMetadata,
          message: messageText,
        }),
        updatedAtMs: now(),
      });
      await storeClient.updateTurnBeat({
        id: completedMetadata.beatId,
        status: 'delivered',
        textShadow: completedMetadata.transcriptText || completedMetadata.playbackPrompt,
        artifactId: null,
        mimeType: null,
        mediaUrl: null,
        deliveredAtMs: now(),
      });
    } else {
      const messageText = 'Voice workflow completed without a recoverable VoiceReference.';
      updatedMessage = await storeClient.updateMessage({
        id: input.message.id,
        kind: 'text',
        status: 'error',
        contentText: completedMetadata.transcriptText || completedMetadata.playbackPrompt,
        reasoningText: input.message.reasoningText,
        error: {
          code: 'AGENT_VOICE_WORKFLOW_REFERENCE_REQUIRED',
          message: messageText,
        },
        traceId: completedMetadata.traceId || null,
        mediaUrl: null,
        mediaMimeType: null,
        artifactId: null,
        metadataJson: toAgentChatVoiceWorkflowMetadataJson({
          ...completedMetadata,
          workflowStatus: 'failed',
          message: messageText,
        }),
        updatedAtMs: now(),
      });
      await storeClient.updateTurnBeat({
        id: completedMetadata.beatId,
        status: 'failed',
        textShadow: completedMetadata.transcriptText || completedMetadata.playbackPrompt,
        artifactId: null,
        mimeType: null,
        mediaUrl: null,
        deliveredAtMs: null,
      });
    }
    return {
      updatedMessage,
      stillPending: false,
    };
  }

  const failureMessage = polled.message || 'Voice workflow failed.';
  const updatedMessage = await storeClient.updateMessage({
    id: input.message.id,
    kind: 'text',
    status: 'error',
    contentText: metadata.transcriptText || metadata.playbackPrompt,
    reasoningText: input.message.reasoningText,
    error: {
      code: polled.workflowStatus === 'canceled'
        ? 'AGENT_VOICE_WORKFLOW_CANCELED'
        : 'AGENT_VOICE_WORKFLOW_FAILED',
      message: failureMessage,
    },
    traceId: polled.traceId || metadata.traceId || null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: toAgentChatVoiceWorkflowMetadataJson({
      ...metadata,
      workflowStatus: polled.workflowStatus,
      traceId: polled.traceId || metadata.traceId || null,
      message: failureMessage,
    }),
    updatedAtMs: now(),
  });
  await storeClient.updateTurnBeat({
    id: metadata.beatId,
    status: 'failed',
    textShadow: metadata.transcriptText || metadata.playbackPrompt,
    artifactId: null,
    mimeType: null,
    mediaUrl: null,
    deliveredAtMs: null,
  });
  return {
    updatedMessage,
    stillPending: false,
  };
}
