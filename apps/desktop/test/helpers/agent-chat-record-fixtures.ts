import type {
  AgentLocalCreateMessageInput,
  AgentLocalMessageRecord,
  AgentLocalTurnBeatInput,
  AgentLocalTurnBeatRecord,
  AgentLocalUpdateMessageInput,
} from '../../src/shell/renderer/bridge/runtime-bridge/types.js';

type PartialWithRequired<T, K extends keyof T> = Partial<T> & Pick<T, K>;

export function createAgentTextMessage(
  input: PartialWithRequired<AgentLocalMessageRecord, 'id' | 'threadId' | 'role' | 'status' | 'contentText' | 'createdAtMs' | 'updatedAtMs'>,
): AgentLocalMessageRecord {
  return {
    kind: 'text',
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    ...input,
  };
}

export function createAgentImageMessage(
  input: PartialWithRequired<AgentLocalMessageRecord, 'id' | 'threadId' | 'role' | 'status' | 'contentText' | 'createdAtMs' | 'updatedAtMs'>,
): AgentLocalMessageRecord {
  return {
    kind: 'image',
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    ...input,
  };
}

export function createAgentVoiceMessage(
  input: PartialWithRequired<AgentLocalMessageRecord, 'id' | 'threadId' | 'role' | 'status' | 'contentText' | 'createdAtMs' | 'updatedAtMs'>,
): AgentLocalMessageRecord {
  return {
    kind: 'voice',
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    ...input,
  };
}

export function createAgentCreateMessageInput(
  input: PartialWithRequired<AgentLocalCreateMessageInput, 'id' | 'threadId' | 'role' | 'status' | 'contentText' | 'createdAtMs' | 'updatedAtMs'>,
): AgentLocalCreateMessageInput {
  return createAgentTextMessage(input);
}

export function createAgentUpdateMessageInput(
  input: PartialWithRequired<AgentLocalUpdateMessageInput, 'id' | 'status' | 'contentText' | 'updatedAtMs'>,
): AgentLocalUpdateMessageInput {
  return {
    kind: 'text',
    reasoningText: null,
    error: null,
    traceId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: null,
    ...input,
  };
}

export function createAgentTurnBeat(
  input: PartialWithRequired<AgentLocalTurnBeatRecord, 'id' | 'turnId' | 'beatIndex' | 'modality' | 'status' | 'createdAtMs' | 'deliveredAtMs'>,
): AgentLocalTurnBeatRecord {
  return {
    textShadow: null,
    artifactId: null,
    mimeType: null,
    mediaUrl: null,
    projectionMessageId: null,
    ...input,
  };
}

export function createAgentTurnBeatInput(
  input: PartialWithRequired<AgentLocalTurnBeatInput, 'id' | 'turnId' | 'beatIndex' | 'modality' | 'status' | 'createdAtMs' | 'deliveredAtMs'>,
): AgentLocalTurnBeatInput {
  return createAgentTurnBeat(input);
}
