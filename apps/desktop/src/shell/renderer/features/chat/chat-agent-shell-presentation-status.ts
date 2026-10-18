import { parseAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
import type { AgentLocalMessageRecord } from '../../bridge/runtime-bridge/types';

// @nimi-authority: rule.nimi.runtime.ai-provider.content-refusal-presentation
export function resolveAgentRefusedInput(messages: readonly AgentLocalMessageRecord[] | undefined): string | null {
  const failure = messages?.at(-1);
  if (failure?.error?.code !== 'AI_CONTENT_FILTER_BLOCKED') return null;
  const turnId = failure.metadataJson?.canonicalTurnId;
  // Media children stay with their original turn. Only the latest refusal
  // offers composer recovery, and it must never borrow another turn's input.
  const original = messages?.slice().reverse().find(message => message.role === 'user'
    && (turnId === undefined || message.metadataJson?.canonicalTurnId === turnId));
  return original?.contentText || null;
}

type AgentMessageWithDebugMetadata = {
  role?: string;
  kind?: string;
  status?: string;
  metadataJson?: unknown;
};

export function resolveLatestAgentStatusCue(
  messages: readonly AgentMessageWithDebugMetadata[] | null | undefined,
) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = messages?.[index];
    if (!message || message.role !== 'assistant' || message.kind !== 'text' || message.status !== 'complete') {
      continue;
    }
    const metadata = parseAgentTextTurnDebugMetadata(message.metadataJson);
    if (metadata?.statusCue) {
      return metadata.statusCue;
    }
  }
  return null;
}

export function assetUrlFromFileUrl(fileUrl: string | null | undefined): string | undefined {
  const normalized = String(fileUrl || '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith('file://')
    ? normalized.replace(/^file:\/\//, 'asset://localhost')
    : normalized;
}
