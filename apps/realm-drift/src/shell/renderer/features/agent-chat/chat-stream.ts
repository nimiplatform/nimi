import type { WorldAgent, WorldDetailWithAgents } from '../world-browser/world-browser-data.js';
import type { ChatMessage } from '@renderer/app-shell/app-store.js';
import { streamPlatformChatResponse } from '@nimiplatform/nimi-kit/features/chat/runtime';

export function buildSystemPrompt(agent: WorldAgent, world: WorldDetailWithAgents): string {
  const parts: string[] = [];

  parts.push(`You are ${agent.name}, a character in the world "${world.name}".`);

  if (agent.bio) {
    parts.push('');
    parts.push(agent.bio);
  }

  if (world.description) {
    parts.push('');
    parts.push(`World description: ${world.description}`);
  }

  if (world.genre || world.era) {
    parts.push('');
    if (world.genre) parts.push(`Genre: ${world.genre}`);
    if (world.era) parts.push(`Era: ${world.era}`);
  }

  parts.push('');
  parts.push('Stay in character. Respond as this character would within the context of this world.');

  return parts.join('\n');
}

export type StreamChatInput = {
  agent: WorldAgent;
  world: WorldDetailWithAgents;
  messages: ChatMessage[];
  userMessage: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onFinish: (fullText: string) => void;
  onError: (error: Error) => void;
};

export async function streamAgentChat(input: StreamChatInput): Promise<void> {
  const { agent, world, messages, userMessage, signal, onDelta, onFinish, onError } = input;

  try {
    const systemPrompt = buildSystemPrompt(agent, world);

    // Build conversation history per RD-CHAT-004
    const conversationInput = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    conversationInput.push({ role: 'user', content: userMessage });

    const result = await streamPlatformChatResponse({
      model: 'auto',
      input: conversationInput,
      system: systemPrompt,
      route: 'cloud',
      metadata: { surfaceId: 'realm-drift', extra: JSON.stringify({ worldId: world.id, agentId: agent.id }) },
      signal,
    }, {
      onDelta: (text) => {
        if (!signal.aborted) {
          onDelta(text);
        }
      },
    });

    if (!signal.aborted && result.text) {
      onFinish(result.text);
    }
  } catch (err) {
    if (signal.aborted) return;
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
