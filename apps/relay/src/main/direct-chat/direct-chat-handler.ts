// Direct Chat Handler — agent-less LLM chat (Jan-like experience)
// Bypasses the beat-first pipeline entirely: no perception, no turn composition,
// no media decision. Pure streaming text generation via Runtime SDK directly.

import type { WebContents } from 'electron';
import type { PlatformClient } from '@nimiplatform/sdk';
import type { TextMessage } from '@nimiplatform/sdk/runtime';
import { createMainProcessChatContext, type MainProcessChatContext } from '../chat-pipeline/main-process-context.js';
import type { ChatMessage } from '../chat-pipeline/types.js';
import { createUlid } from '../chat-pipeline/ulid.js';
import {
  createLocalChatSession,
  listLocalChatSessions,
  appendTurnsToSession,
  clearSession,
  createSessionTurn,
} from '../session-store/index.js';
import { findConversationForScope } from '../session-store/session-store-helpers.js';
import type { RouteState } from '../route/route-state.js';

export const DIRECT_CHAT_TARGET_ID = '__direct__';
const DIRECT_CHAT_VIEWER_ID = 'local-user';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful, knowledgeable AI assistant. Respond clearly and concisely.';

type ActiveDirectChatTurn = {
  abortController: AbortController;
  turnTxnId: string;
};

export function createDirectChatHandlers(
  runtime: PlatformClient['runtime'],
  getWebContents: () => WebContents | null,
  routeState?: RouteState,
) {
  const activeTurns = new Map<string, ActiveDirectChatTurn>();

  async function send(input: { text: string; sessionId?: string }): Promise<void> {
    const wc = getWebContents();
    if (!wc) throw new Error('No renderer available');

    const text = String(input.text || '').trim();
    if (!text) return;

    const resolvedRoute = routeState?.getResolved() ?? null;
    if (!resolvedRoute) {
      throw new Error('RELAY_DIRECT_CHAT_NO_ROUTE: No model route configured. Please select a model.');
    }

    // Ensure a working session
    const existingSessionId = String(input.sessionId || '').trim();
    let sessionId = existingSessionId;
    if (!sessionId) {
      const existing = findConversationForScope({
        targetId: DIRECT_CHAT_TARGET_ID,
        viewerId: DIRECT_CHAT_VIEWER_ID,
      });
      if (existing) {
        sessionId = existing.id;
      } else {
        const session = await createLocalChatSession({
          targetId: DIRECT_CHAT_TARGET_ID,
          viewerId: DIRECT_CHAT_VIEWER_ID,
          title: 'Direct Chat',
        });
        sessionId = session.id;
      }
    }

    // Load existing messages for context
    let initialMessages: ChatMessage[] = [];
    try {
      const sessions = await listLocalChatSessions(DIRECT_CHAT_TARGET_ID, DIRECT_CHAT_VIEWER_ID);
      if (sessions.length > 0 && sessions[0]) {
        initialMessages = sessions[0].turns
          .filter((turn): turn is typeof turn & { role: 'user' | 'assistant' } =>
            turn.role === 'user' || turn.role === 'assistant',
          )
          .map((turn) => ({
            id: turn.id,
            role: turn.role,
            kind: turn.kind,
            content: turn.content,
            timestamp: typeof turn.timestamp === 'string' ? new Date(turn.timestamp) : turn.timestamp,
            latencyMs: turn.latencyMs,
            meta: turn.meta,
          }));
      }
    } catch {
      // Proceed with empty context
    }

    const chatContext: MainProcessChatContext = createMainProcessChatContext(wc, initialMessages);

    // Create user message and show immediately
    const userMessage: ChatMessage = {
      id: `msg_${createUlid()}`,
      role: 'user',
      kind: 'text',
      content: text,
      timestamp: new Date(),
    };
    chatContext.setMessages((prev) => [...prev, userMessage]);

    const turnTxnId = `dtxn_${createUlid()}`;
    const assistantMessageId = `msg_${createUlid()}`;
    const abortController = new AbortController();
    activeTurns.set(turnTxnId, { abortController, turnTxnId });

    chatContext.setSendPhase('streaming-first-beat', turnTxnId);

    const startedAt = performance.now();

    try {
      // Persist user turn
      await appendTurnsToSession(sessionId, [
        createSessionTurn({ message: userMessage }),
      ]);

      // Build multi-turn prompt as TextMessage[] for proper chat
      const historyMessages: TextMessage[] = chatContext.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => m.kind !== 'streaming')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Show transient streaming message
      const transientMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        kind: 'streaming',
        content: '',
        timestamp: new Date(),
      };
      chatContext.setMessages((prev) => [...prev, transientMessage]);

      // Stream response using Runtime SDK directly (supports TextMessage[])
      const routePolicy = resolvedRoute.source === 'cloud' ? 'cloud' as const : 'local' as const;
      const streamOutput = await runtime.ai.text.stream({
        model: resolvedRoute.model,
        input: historyMessages,
        system: DEFAULT_SYSTEM_PROMPT,
        maxTokens: 4096,
        temperature: 0.7,
        route: routePolicy,
        connectorId: resolvedRoute.connectorId,
        subjectUserId: DIRECT_CHAT_VIEWER_ID,
        signal: abortController.signal,
      });

      let fullText = '';
      for await (const event of streamOutput.stream) {
        if (abortController.signal.aborted) break;

        if (event.type === 'delta') {
          fullText += event.text;
          chatContext.setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? { ...m, content: fullText, kind: 'streaming' as const }
                : m,
            ),
          );
        }

        if (event.type === 'finish') {
          break;
        }

        if (event.type === 'error') {
          throw event.error;
        }
      }

      if (abortController.signal.aborted) {
        // Mark as text but keep partial content
        chatContext.setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, kind: 'text' as const }
              : m,
          ),
        );
        return;
      }

      const latencyMs = Math.round(performance.now() - startedAt);

      // Finalize assistant message
      const finalMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        kind: 'text',
        content: fullText,
        timestamp: new Date(),
        latencyMs,
      };
      chatContext.setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId ? finalMessage : m,
        ),
      );

      // Persist assistant turn
      await appendTurnsToSession(sessionId, [
        createSessionTurn({ message: finalMessage }),
      ]);
    } catch (error) {
      if (abortController.signal.aborted) return;

      const errorMessage = error instanceof Error ? error.message : String(error);
      chatContext.setStatusBanner({ kind: 'error', message: errorMessage });

      // Remove transient message on error
      chatContext.setMessages((prev) =>
        prev.filter((m) => m.id !== assistantMessageId),
      );
    } finally {
      activeTurns.delete(turnTxnId);
      chatContext.setSendPhase('idle', turnTxnId);
    }
  }

  function cancel(input: { turnTxnId: string }): void {
    const turnTxnId = String(input.turnTxnId || '').trim();
    const turn = activeTurns.get(turnTxnId);
    if (turn) {
      turn.abortController.abort();
    }
  }

  async function history(): Promise<ChatMessage[]> {
    const sessions = await listLocalChatSessions(DIRECT_CHAT_TARGET_ID, DIRECT_CHAT_VIEWER_ID);
    if (sessions.length > 0 && sessions[0]) {
      return sessions[0].turns
        .filter((turn): turn is typeof turn & { role: 'user' | 'assistant' } =>
          turn.role === 'user' || turn.role === 'assistant',
        )
        .map((turn) => ({
          id: turn.id,
          role: turn.role,
          kind: turn.kind,
          content: turn.content,
          timestamp: typeof turn.timestamp === 'string' ? new Date(turn.timestamp) : turn.timestamp,
          latencyMs: turn.latencyMs,
          meta: turn.meta,
          media: turn.media,
        }));
    }
    return [];
  }

  async function clear(input?: { sessionId?: string }): Promise<void> {
    const sessionId = String(input?.sessionId || '').trim();
    if (sessionId) {
      await clearSession(sessionId);
      return;
    }
    // Clear all direct chat sessions
    const sessions = await listLocalChatSessions(DIRECT_CHAT_TARGET_ID, DIRECT_CHAT_VIEWER_ID);
    for (const session of sessions) {
      await clearSession(session.id);
    }
  }

  return { send, cancel, history, clear };
}
