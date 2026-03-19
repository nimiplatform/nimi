// RL-FEAT-002 — Human Chat
// RL-INTOP-001 — Multi-App Chat Interop
// RL-CORE-002 — Agent Binding Propagation (channel scoped to agent's world)

import { useState, useCallback, useEffect } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import type { RelayRealtimeMessage } from '../../../../shared/ipc-contract.js';

export type HumanMessage = RelayRealtimeMessage;

export function useHumanChat() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const realtimeConnected = useAppStore((s) => s.realtimeConnected);
  const [messages, setMessages] = useState<HumanMessage[]>([]);

  // RL-CORE-002: Reset and re-subscribe when agent changes
  useEffect(() => {
    setMessages([]);
    if (!currentAgent) return;

    const bridge = getBridge();

    // Subscribe to agent's channel via socket.io (RL-INTOP-003)
    const channel = `agent:${currentAgent.id}`;
    bridge.realtime.subscribe(channel);

    // Listen for real-time messages (RL-IPC-009)
    const listenerId = bridge.realtime.onMessage((message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      bridge.realtime.unsubscribe(channel);
      bridge.realtime.removeListener(listenerId);
    };
  }, [currentAgent?.id]);

  const sendMessage = useCallback(async (text: string) => {
    if (!currentAgent) return;

    const bridge = getBridge();
    await bridge.humanChat.sendMessage({
      agentId: currentAgent.id,
      text,
    });
  }, [currentAgent]);

  return {
    messages,
    sendMessage,
    canChat: !!currentAgent && realtimeConnected,
  };
}
