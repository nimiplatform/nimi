import { asRecord, normalizeText } from './helpers.js';
import type { RuntimeAgentMessage, RuntimeAgentTranscriptMessage } from './types-runtime-agent.js';

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseTranscript(value: unknown): RuntimeAgentTranscriptMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const transcript: RuntimeAgentTranscriptMessage[] = [];
  for (const item of value) {
    const payload = asRecord(item);
    const id = optionalString(payload.id);
    const role = normalizeText(payload.role) as RuntimeAgentMessage['role'] | '';
    const content = optionalContentString(payload.content);
    const name = optionalString(payload.name);
    const status = optionalString(payload.status) as RuntimeAgentMessage['status'] | undefined;
    const kind = optionalString(payload.kind) as RuntimeAgentMessage['kind'] | undefined;
    const createdAt = optionalString(payload.created_at);
    const updatedAt = optionalString(payload.updated_at);
    const parentMessageId = optionalString(payload.parent_message_id);
    const traceId = optionalString(payload.trace_id);
    const reasoningText = optionalContentString(payload.reasoning_text);
    const mediaUrl = optionalString(payload.media_url);
    const mediaMimeType = optionalString(payload.media_mime_type);
    const artifactId = optionalString(payload.artifact_id);
    const metadata = asRecord(payload.metadata);
    if (
      !id
      || !isRuntimeAgentTranscriptRole(role)
      || content === undefined
      || !isRuntimeAgentTranscriptStatus(status)
      || !isRuntimeAgentTranscriptKind(kind)
      || !isValidIsoTimestamp(createdAt)
      || !isValidIsoTimestamp(updatedAt)
    ) {
      return undefined;
    }
    transcript.push({
      id,
      role,
      content,
      ...(name ? { name } : {}),
      status,
      kind,
      createdAt,
      updatedAt,
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(reasoningText !== undefined ? { reasoningText } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaMimeType ? { mediaMimeType } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }
  return transcript.length > 0 ? transcript : undefined;
}

function isRuntimeAgentTranscriptRole(value: string): value is RuntimeAgentMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function isRuntimeAgentTranscriptStatus(
  value: string | undefined,
): value is RuntimeAgentTranscriptMessage['status'] {
  return value === 'pending' || value === 'complete' || value === 'error';
}

function isRuntimeAgentTranscriptKind(
  value: string | undefined,
): value is RuntimeAgentTranscriptMessage['kind'] {
  return value === 'text' || value === 'image' || value === 'voice' || value === 'video' || value === 'tool';
}

function isValidIsoTimestamp(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}
