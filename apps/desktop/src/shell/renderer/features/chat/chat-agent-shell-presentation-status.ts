import { parseAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';

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
