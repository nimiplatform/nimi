// Unified chat hook — single IPC subscription, dispatches to direct or agent mode.
// Prevents double-listener issues from running both useDirectChat + usePipelineChat.

import { useEffect, useCallback, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { useChatStore } from '../../../app-shell/providers/chat-store.js';

export type ChatMode = 'direct' | 'agent';

export function useChat() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const mode: ChatMode = currentAgent ? 'agent' : 'direct';
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const {
    messages,
    sendPhase,
    activeTurnTxnId,
    statusBanner,
    setMessages,
    setSendPhase,
    setStatusBanner,
    setPromptTrace,
    setTurnAudit,
    clearChat,
  } = useChatStore();

  // Single IPC subscription — shared by both modes
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

    ids.push(bridge.chat.onPromptTrace((trace) => {
      setPromptTrace(trace);
    }));

    ids.push(bridge.chat.onTurnAudit((audit) => {
      setTurnAudit(audit);
    }));

    return () => {
      for (const id of ids) {
        bridge.chat.removeListener(id);
      }
    };
  }, [setMessages, setSendPhase, setStatusBanner, setPromptTrace, setTurnAudit]);

  // Load history when mode or agent changes
  useEffect(() => {
    clearChat();
    let disposed = false;

    if (mode === 'direct') {
      // Direct mode — load direct chat history
      getBridge().directChat.history()
        .then((result) => {
          if (disposed) return;
          setMessages(result);
        })
        .catch((err) => {
          if (disposed) return;
          console.warn('[relay:chat] direct history load failed', err);
        });
    } else if (currentAgent) {
      // Agent mode — load agent session history
      const requestAgentId = currentAgent.id;
      getBridge().chat.history({ agentId: requestAgentId })
        .then((result) => {
          if (disposed || currentAgent?.id !== requestAgentId) return;
          setMessages(result);
        })
        .catch((err) => {
          if (disposed || currentAgent?.id !== requestAgentId) return;
          console.warn('[relay:chat] agent history load failed', err);
          setStatusBanner({ kind: 'warning', message: `History load failed: ${err instanceof Error ? err.message : String(err)}` });
        });
    }

    return () => {
      disposed = true;
    };
  }, [mode, currentAgent?.id, clearChat, setMessages, setStatusBanner]);

  // Send — dispatches to the right IPC channel
  const sendMessage = useCallback(async (text: string) => {
    if (!runtimeAvailable) return;
    if (!text.trim()) return;

    if (modeRef.current === 'direct') {
      void getBridge().directChat.send({ text: text.trim() }).catch((err) => {
        console.error('[relay:chat] direct sendMessage failed', err);
        setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    } else {
      const agent = useAppStore.getState().currentAgent;
      if (!agent) return;
      void getBridge().chat.send({ agentId: agent.id, text: text.trim() }).catch((err) => {
        console.error('[relay:chat] agent sendMessage failed', err);
        setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    }
  }, [runtimeAvailable, setStatusBanner]);

  // Cancel — dispatches to the right IPC channel
  const cancelTurn = useCallback(async (turnTxnId?: string) => {
    const transactionId = String(turnTxnId || activeTurnTxnId || '').trim();
    if (!transactionId) return;

    try {
      if (modeRef.current === 'direct') {
        await getBridge().directChat.cancel({ turnTxnId: transactionId });
      } else {
        await getBridge().chat.cancel({ turnTxnId: transactionId });
      }
    } catch (err) {
      console.warn('[relay:chat] cancelTurn failed', err);
    }
  }, [activeTurnTxnId]);

  // Clear history — dispatches to the right IPC channel
  const clearHistory = useCallback(async () => {
    try {
      if (modeRef.current === 'direct') {
        await getBridge().directChat.clear();
      } else {
        const agent = useAppStore.getState().currentAgent;
        if (!agent) return;
        await getBridge().chat.clear({ agentId: agent.id, sessionId: '' });
      }
      clearChat();
    } catch (err) {
      console.error('[relay:chat] clearHistory failed', err);
      setStatusBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [clearChat, setStatusBanner]);

  return {
    messages,
    sendPhase,
    activeTurnTxnId,
    statusBanner,
    isSending: sendPhase !== 'idle',
    canChat: mode === 'direct' ? runtimeAvailable : (!!currentAgent && runtimeAvailable),
    sendMessage,
    cancelTurn,
    clearHistory,
    mode,
  };
}
