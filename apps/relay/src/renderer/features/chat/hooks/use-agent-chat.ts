// RL-FEAT-001 — Agent Chat (Local AI)
// RL-CORE-002 — Agent Binding Propagation
// RL-CORE-004 — agentId in every agent-scoped IPC

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

export function processStreamChunk(
  messages: ChatMessage[],
  assistantMsgId: string,
  ownStreamId: string,
  payload: { streamId: string; data: unknown },
): { messages: ChatMessage[]; changed: boolean } {
  if (payload.streamId !== ownStreamId) {
    return { messages, changed: false };
  }
  const part = payload.data as { type?: unknown; text?: unknown };
  if (part.type !== 'text' || typeof part.text !== 'string' || part.text.length === 0) {
    return { messages, changed: false };
  }
  return {
    messages: messages.map((message) =>
      message.id === assistantMsgId
        ? { ...message, text: message.text + part.text }
        : message,
    ),
    changed: true,
  };
}

export function processStreamEnd(
  messages: ChatMessage[],
  assistantMsgId: string,
  ownStreamId: string,
  payload: { streamId: string },
): { messages: ChatMessage[]; matched: boolean } {
  if (payload.streamId !== ownStreamId) {
    return { messages, matched: false };
  }
  return {
    messages: messages.map((message) =>
      message.id === assistantMsgId ? { ...message, streaming: false } : message,
    ),
    matched: true,
  };
}

export function processStreamError(
  messages: ChatMessage[],
  assistantMsgId: string,
  ownStreamId: string,
  payload: { streamId: string },
): { messages: ChatMessage[]; matched: boolean } {
  if (payload.streamId !== ownStreamId) {
    return { messages, matched: false };
  }
  return {
    messages: messages.map((message) =>
      message.id === assistantMsgId
        ? { ...message, text: message.text || 'Error occurred', streaming: false }
        : message,
    ),
    matched: true,
  };
}

export function useAgentChat() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeStreamRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // RL-CORE-002: Reset chat when agent changes
  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
    setIsStreaming(false);
    if (activeStreamRef.current) {
      getBridge().ai.streamCancel(activeStreamRef.current);
      activeStreamRef.current = null;
    }
  }, [currentAgent?.id]);

  const sendMessage = useCallback(async (prompt: string) => {
    if (!currentAgent || !runtimeAvailable) return;

    const bridge = getBridge();
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: prompt,
    };

    const assistantMsg: ChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      text: '',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      // RL-CORE-004: agentId in input payload
      const { streamId } = await bridge.ai.streamOpen({
        agentId: currentAgent.id,
        prompt,
      });
      activeStreamRef.current = streamId;

      // Listen for stream chunks — RuntimeStreamChunk shape: { type: 'text', text } | { type: 'done', ... }
      const chunkId = bridge.stream.onChunk((payload) => {
        const next = processStreamChunk(messagesRef.current, assistantMsg.id, streamId, payload);
        if (next.changed) {
          messagesRef.current = next.messages;
          setMessages((prev) =>
            processStreamChunk(prev, assistantMsg.id, streamId, payload).messages,
          );
        }
      });

      const cleanup = () => {
        bridge.stream.removeListener(chunkId);
        bridge.stream.removeListener(endId);
        bridge.stream.removeListener(errorId);
      };

      const endId = bridge.stream.onEnd((payload) => {
        const next = processStreamEnd(messagesRef.current, assistantMsg.id, streamId, payload);
        if (!next.matched) return;
        messagesRef.current = next.messages;
        setMessages(next.messages);
        setIsStreaming(false);
        activeStreamRef.current = null;
        cleanup();
      });

      const errorId = bridge.stream.onError((payload) => {
        const next = processStreamError(messagesRef.current, assistantMsg.id, streamId, payload);
        if (!next.matched) return;
        messagesRef.current = next.messages;
        setMessages(next.messages);
        setIsStreaming(false);
        activeStreamRef.current = null;
        cleanup();
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, text: 'Failed to start stream', streaming: false }
            : m,
        ),
      );
      setIsStreaming(false);
    }
  }, [currentAgent, runtimeAvailable]);

  const cancelStream = useCallback(() => {
    if (activeStreamRef.current) {
      getBridge().ai.streamCancel(activeStreamRef.current);
      activeStreamRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    cancelStream,
    canChat: !!currentAgent && runtimeAvailable,
  };
}
