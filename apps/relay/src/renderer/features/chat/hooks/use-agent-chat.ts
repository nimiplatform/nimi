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

export function useAgentChat() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeStreamRef = useRef<string | null>(null);

  // RL-CORE-002: Reset chat when agent changes
  useEffect(() => {
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
        if (payload.streamId !== streamId) return;
        const part = payload.data as { type: string; text?: string };
        if (part.type === 'text' && part.text) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, text: m.text + part.text }
                : m,
            ),
          );
        }
      });

      const cleanup = () => {
        bridge.stream.removeListener(chunkId);
        bridge.stream.removeListener(endId);
        bridge.stream.removeListener(errorId);
      };

      const endId = bridge.stream.onEnd((payload) => {
        if (payload.streamId !== streamId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, streaming: false } : m,
          ),
        );
        setIsStreaming(false);
        activeStreamRef.current = null;
        cleanup();
      });

      const errorId = bridge.stream.onError((payload) => {
        if (payload.streamId !== streamId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, text: m.text || 'Error occurred', streaming: false }
              : m,
          ),
        );
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
