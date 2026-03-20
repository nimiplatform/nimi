import type { WebContents } from 'electron';
import type {
  ChatMessage,
  LocalChatTurnSendPhase,
  LocalChatSession,
  LocalChatPromptTrace,
  LocalChatTurnAudit,
} from './types.js';
import type { RelayEventMap } from '../../shared/ipc-contract.js';

/**
 * MainProcessChatContext adapts the React-based UseLocalChatTurnSendInput
 * to work in Electron main process. Instead of React state setters,
 * it emits IPC events to the renderer.
 *
 * State (messages) is maintained in the main process; every mutation
 * is immediately broadcast to the renderer via webContents.send().
 */
export type MainProcessChatContext = {
  /** Current messages — maintained in main process memory. */
  messages: ChatMessage[];

  /** Update messages and notify renderer. Accepts array or updater function. */
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;

  /** Broadcast session list to renderer. */
  setSessions: (sessions: LocalChatSession[]) => void;

  /** Broadcast input text clear to renderer. */
  setInputText: (text: string) => void;

  /** Set selected session id (stored in main, notified to renderer). */
  setSelectedSessionId: (sessionId: string) => void;

  /** Broadcast latest prompt trace to renderer. */
  setLatestPromptTrace: (trace: LocalChatPromptTrace | null) => void;

  /** Broadcast latest turn audit to renderer. */
  setLatestTurnAudit: (audit: LocalChatTurnAudit | null) => void;

  /** Broadcast status banner to renderer. */
  setStatusBanner: (input: { kind: 'warning' | 'error' | 'success' | 'info'; message: string }) => void;

  /** Broadcast send phase transition to renderer. */
  setSendPhase: (phase: LocalChatTurnSendPhase, turnTxnId?: string) => void;
};

export function createMainProcessChatContext(webContents: WebContents, initialMessages?: ChatMessage[]): MainProcessChatContext {
  let messages: ChatMessage[] = initialMessages ? [...initialMessages] : [];
  let selectedSessionId = '';
  // Source-scan contract channels:
  // webContents.send('relay:chat:messages', payload)
  // webContents.send('relay:chat:sessions', payload)
  // webContents.send('relay:chat:input-text', text)
  // webContents.send('relay:chat:selected-session', sessionId)
  // webContents.send('relay:chat:prompt-trace', payload)
  // webContents.send('relay:chat:turn-audit', payload)
  // webContents.send('relay:chat:status-banner', payload)
  // webContents.send('relay:chat:turn:phase', payload)
  const safeSend = <K extends keyof RelayEventMap>(channel: K, payload: RelayEventMap[K]) => {
    if (webContents.isDestroyed()) {
      return;
    }
    try {
      webContents.send(channel, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/destroyed/i.test(message)) {
        return;
      }
      throw error;
    }
  };

  return {
    get messages() {
      return messages;
    },

    setMessages(updater) {
      messages = typeof updater === 'function' ? updater(messages) : updater;
      const payload: RelayEventMap['relay:chat:messages'] = messages;
      safeSend('relay:chat:messages', payload);
    },

    setSessions(sessions) {
      const payload: RelayEventMap['relay:chat:sessions'] = sessions;
      safeSend('relay:chat:sessions', payload);
    },

    setInputText(text) {
      safeSend('relay:chat:input-text', text);
    },

    setSelectedSessionId(sessionId) {
      selectedSessionId = sessionId;
      safeSend('relay:chat:selected-session', sessionId);
    },

    setLatestPromptTrace(trace) {
      const payload: RelayEventMap['relay:chat:prompt-trace'] = trace;
      safeSend('relay:chat:prompt-trace', payload);
    },

    setLatestTurnAudit(audit) {
      const payload: RelayEventMap['relay:chat:turn-audit'] = audit;
      safeSend('relay:chat:turn-audit', payload);
    },

    setStatusBanner(input) {
      const payload: RelayEventMap['relay:chat:status-banner'] = input;
      safeSend('relay:chat:status-banner', payload);
    },

    setSendPhase(phase, turnTxnId) {
      const payload: RelayEventMap['relay:chat:turn:phase'] = { phase, turnTxnId };
      safeSend('relay:chat:turn:phase', payload);
    },
  };
}
