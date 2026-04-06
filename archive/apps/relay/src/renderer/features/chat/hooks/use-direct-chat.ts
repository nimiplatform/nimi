// Direct chat hook — agent-less LLM chat via relay:direct-chat:* IPC.
// Mirrors usePipelineChat shape but dispatches to direct chat handlers.

import { useEffect, useCallback, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { useChatStore } from '../../../app-shell/providers/chat-store.js';

export function useDirectChat() {
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const {
    messages,
    sendPhase,
    activeTurnTxnId,
    statusBanner,
    setMessages,
    setSendPhase,
    setStatusBanner,
    clearChat,
  } = useChatStore();

  const listenersRef = useRef<string[]>([]);

  // Subscribe to IPC push events — same channels as pipeline chat
  useEffect(() => {
    const bridge = getBridge();
    const ids: string[] = [];

    ids.push(bridge.chat.onMessages((msgs) => {
      setMessages(msgs);
    }));

    ids.push(bridge.chat.onTurnPhase((payload) => {
      setSendPhase(payload.phase, payload.turnTxnId);
    }));

    ids.push(bridge.chat.onStatusBanner((banner) => {
      setStatusBanner(banner);
    }));

    listenersRef.current = ids;

    return () => {
      for (const id of ids) {
        bridge.chat.removeListener(id);
      }
      listenersRef.current = [];
    };
  }, [setMessages, setSendPhase, setStatusBanner]);

  // Load direct chat history on mount
  useEffect(() => {
    clearChat();
    let disposed = false;

    getBridge().directChat.history()
      .then((result) => {
        if (disposed) return;
        setMessages(result);
      })
      .catch((err) => {
        if (disposed) return;
        console.warn('[relay:direct-chat] history load failed', err);
      });

    return () => {
      disposed = true;
    };
  }, [clearChat, setMessages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!runtimeAvailable) return;
    if (!text.trim()) return;

    void getBridge().directChat.send({
      text: text.trim(),
    }).catch((err) => {
      console.error('[relay:direct-chat] sendMessage failed', err);
      setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  }, [runtimeAvailable, setStatusBanner]);

  const cancelTurn = useCallback(async (turnTxnId?: string) => {
    const transactionId = String(turnTxnId || activeTurnTxnId || '').trim();
    if (!transactionId) return;
    try {
      await getBridge().directChat.cancel({ turnTxnId: transactionId });
    } catch (err) {
      console.warn('[relay:direct-chat] cancelTurn failed', err);
    }
  }, [activeTurnTxnId]);

  const clearHistory = useCallback(async () => {
    try {
      await getBridge().directChat.clear();
      clearChat();
    } catch (err) {
      console.error('[relay:direct-chat] clearHistory failed', err);
      setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [clearChat, setStatusBanner]);

  return {
    messages,
    sendPhase,
    activeTurnTxnId,
    statusBanner,
    isSending: sendPhase !== 'idle',
    canChat: runtimeAvailable,
    sendMessage,
    cancelTurn,
    clearHistory,
  };
}
