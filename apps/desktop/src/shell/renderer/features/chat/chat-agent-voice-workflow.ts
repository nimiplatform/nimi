import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentVoiceWorkflowCapability } from './conversation-capability';
import type { AgentVoicePlaybackCueEnvelope } from './chat-agent-voice-playback-envelope';
import {
  parseAgentVoicePlaybackCueEnvelope,
  toAgentVoicePlaybackCueEnvelopeJson,
} from './chat-agent-voice-playback-envelope';

export type AgentChatVoiceWorkflowType = 'tts_v2v' | 'tts_t2v';

export type AgentChatVoiceReferenceMeaning =
  | {
    kind: 'preset_voice_id';
    stableRef: string;
  }
  | {
    kind: 'voice_asset_id';
    stableRef: string;
  }
  | {
    kind: 'provider_voice_ref';
    stableRef: string;
  };

export type AgentChatVoiceWorkflowStatus =
  | 'submitted'
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'canceled';

export type AgentChatVoiceWorkflowMessageMetadata = {
  kind: 'voice-workflow';
  version: 'v1';
  sourceTurnId: string;
  sourceMessageId: string;
  sourceActionId: string;
  beatId: string;
  workflowCapability: AgentVoiceWorkflowCapability;
  workflowType: AgentChatVoiceWorkflowType;
  workflowStatus: AgentChatVoiceWorkflowStatus;
  jobId: string;
  playbackPrompt: string;
  transcriptText: string;
  traceId?: string | null;
  message?: string | null;
  voiceReference?: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId?: string | null;
  providerVoiceRef?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  artifactId?: string | null;
  playbackCueEnvelope?: AgentVoicePlaybackCueEnvelope | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isVoiceReferenceKind(value: string): value is AgentChatVoiceReferenceMeaning['kind'] {
  return value === 'preset_voice_id'
    || value === 'voice_asset_id'
    || value === 'provider_voice_ref';
}

function isWorkflowStatus(value: string): value is AgentChatVoiceWorkflowStatus {
  return value === 'submitted'
    || value === 'queued'
    || value === 'running'
    || value === 'complete'
    || value === 'failed'
    || value === 'canceled';
}

function isWorkflowType(value: string): value is AgentChatVoiceWorkflowType {
  return value === 'tts_v2v' || value === 'tts_t2v';
}

function isWorkflowCapability(value: string): value is AgentVoiceWorkflowCapability {
  return value === 'voice_workflow.tts_v2v' || value === 'voice_workflow.tts_t2v';
}

export function toAgentChatVoiceWorkflowMetadataJson(
  metadata: AgentChatVoiceWorkflowMessageMetadata,
): JsonObject {
  return {
    kind: metadata.kind,
    version: metadata.version,
    sourceTurnId: metadata.sourceTurnId,
    sourceMessageId: metadata.sourceMessageId,
    sourceActionId: metadata.sourceActionId,
    beatId: metadata.beatId,
    workflowCapability: metadata.workflowCapability,
    workflowType: metadata.workflowType,
    workflowStatus: metadata.workflowStatus,
    jobId: metadata.jobId,
    playbackPrompt: metadata.playbackPrompt,
    transcriptText: metadata.transcriptText,
    traceId: metadata.traceId || null,
    message: metadata.message || null,
    voiceReference: metadata.voiceReference
      ? {
        kind: metadata.voiceReference.kind,
        stableRef: metadata.voiceReference.stableRef,
      }
      : null,
    voiceAssetId: metadata.voiceAssetId || null,
    providerVoiceRef: metadata.providerVoiceRef || null,
    mediaUrl: metadata.mediaUrl || null,
    mediaMimeType: metadata.mediaMimeType || null,
    artifactId: metadata.artifactId || null,
    playbackCueEnvelope: metadata.playbackCueEnvelope
      ? toAgentVoicePlaybackCueEnvelopeJson(metadata.playbackCueEnvelope)
      : null,
  };
}

export function parseAgentChatVoiceWorkflowMetadata(
  value: unknown,
): AgentChatVoiceWorkflowMessageMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (normalizeText(record.kind) !== 'voice-workflow' || normalizeText(record.version) !== 'v1') {
    return null;
  }
  const workflowCapability = normalizeText(record.workflowCapability);
  const workflowType = normalizeText(record.workflowType);
  const workflowStatus = normalizeText(record.workflowStatus);
  if (!isWorkflowCapability(workflowCapability) || !isWorkflowType(workflowType) || !isWorkflowStatus(workflowStatus)) {
    return null;
  }
  const sourceTurnId = normalizeText(record.sourceTurnId);
  const sourceMessageId = normalizeText(record.sourceMessageId);
  const sourceActionId = normalizeText(record.sourceActionId);
  const beatId = normalizeText(record.beatId);
  const jobId = normalizeText(record.jobId);
  const playbackPrompt = normalizeText(record.playbackPrompt);
  const transcriptText = typeof record.transcriptText === 'string'
    ? record.transcriptText
    : playbackPrompt;
  if (!sourceTurnId || !sourceMessageId || !sourceActionId || !beatId || !jobId || !playbackPrompt) {
    return null;
  }
  const voiceReferenceRecord = record.voiceReference;
  let voiceReference: AgentChatVoiceReferenceMeaning | null = null;
  if (voiceReferenceRecord && typeof voiceReferenceRecord === 'object' && !Array.isArray(voiceReferenceRecord)) {
    const nextRecord = voiceReferenceRecord as Record<string, unknown>;
    const kind = normalizeText(nextRecord.kind);
    const stableRef = normalizeText(nextRecord.stableRef);
    if (isVoiceReferenceKind(kind) && stableRef) {
      voiceReference = {
        kind,
        stableRef,
      };
    }
  }
  return {
    kind: 'voice-workflow',
    version: 'v1',
    sourceTurnId,
    sourceMessageId,
    sourceActionId,
    beatId,
    workflowCapability,
    workflowType,
    workflowStatus,
    jobId,
    playbackPrompt,
    transcriptText,
    traceId: normalizeText(record.traceId) || null,
    message: normalizeText(record.message) || null,
    voiceReference,
    voiceAssetId: normalizeText(record.voiceAssetId) || null,
    providerVoiceRef: normalizeText(record.providerVoiceRef) || null,
    mediaUrl: normalizeText(record.mediaUrl) || null,
    mediaMimeType: normalizeText(record.mediaMimeType) || null,
    artifactId: normalizeText(record.artifactId) || null,
    playbackCueEnvelope: parseAgentVoicePlaybackCueEnvelope(record.playbackCueEnvelope),
  };
}
