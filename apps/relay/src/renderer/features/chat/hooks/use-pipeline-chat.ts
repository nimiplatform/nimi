// RL-PIPE-001 — Pipeline-aware chat hook
// Replaces use-agent-chat.ts for the beat-first turn pipeline.
// Renderer is a thin consumer: sends via IPC, receives structured beat messages.

import { useEffect, useCallback, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { useChatStore } from '../../../app-shell/providers/chat-store.js';

export function usePipelineChat() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const {
    messages,
    sendPhase,
    statusBanner,
    setMessages,
    setSendPhase,
    setStatusBanner,
    setPromptTrace,
    setTurnAudit,
    clearChat,
  } = useChatStore();

  const listenersRef = useRef<string[]>([]);

  // Subscribe to IPC push events from main process
  useEffect(() => {
    const bridge = getBridge();
    const ids: string[] = [];

    ids.push(bridge.chat.onMessages((msgs) => {
      setMessages(msgs);
    }));

    ids.push(bridge.chat.onTurnPhase((payload) => {
      setSendPhase(payload.phase);
    }));

    ids.push(bridge.chat.onStatusBanner((banner) => {
      setStatusBanner(banner);
    }));

    ids.push(bridge.chat.onPromptTrace((trace) => {
      setPromptTrace(trace);
    }));

    ids.push(bridge.chat.onTurnAudit((audit) => {
      setTurnAudit(audit);
    }));

    listenersRef.current = ids;

    return () => {
      for (const id of ids) {
        bridge.chat.removeListener(id);
      }
      listenersRef.current = [];
    };
  }, [setMessages, setSendPhase, setStatusBanner, setPromptTrace, setTurnAudit]);

  // RL-CORE-002: Reset chat when agent changes
  useEffect(() => {
    clearChat();

    if (!currentAgent) return;

    // Load session history for new agent
    getBridge().chat.history({ agentId: currentAgent.id })
      .then((result) => {
        setMessages(result);
      })
      .catch((err) => {
        console.warn('[relay:chat] history load failed', err);
        setStatusBanner({ kind: 'warning', message: `History load failed: ${err instanceof Error ? err.message : String(err)}` });
      });
  }, [currentAgent?.id, clearChat, setMessages, setStatusBanner]);

  const sendMessage = useCallback(async (text: string) => {
    if (!currentAgent || !runtimeAvailable) return;
    if (!text.trim()) return;

    try {
      await getBridge().chat.send({
        agentId: currentAgent.id,
        text: text.trim(),
      });
    } catch (err) {
      console.error('[relay:chat] sendMessage failed', err);
      setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [currentAgent, runtimeAvailable, setStatusBanner]);

  const cancelTurn = useCallback(async (turnTxnId: string) => {
    try {
      await getBridge().chat.cancel({ turnTxnId });
    } catch (err) {
      console.warn('[relay:chat] cancelTurn failed', err);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!currentAgent) return;
    try {
      await getBridge().chat.clear({
        agentId: currentAgent.id,
        sessionId: '', // clears active session
      });
      clearChat();
    } catch (err) {
      console.error('[relay:chat] clearHistory failed', err);
      setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [currentAgent, clearChat, setStatusBanner]);

  return {
    messages,
    sendPhase,
    statusBanner,
    isSending: sendPhase !== 'idle',
    canChat: !!currentAgent && runtimeAvailable,
    sendMessage,
    cancelTurn,
    clearHistory,
  };
}
