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
  setSendPhase: (phase: LocalChatTurnSendPhase) => void;
};

export function createMainProcessChatContext(webContents: WebContents): MainProcessChatContext {
  let messages: ChatMessage[] = [];
  let selectedSessionId = '';

  return {
    get messages() {
      return messages;
    },

    setMessages(updater) {
      messages = typeof updater === 'function' ? updater(messages) : updater;
      const payload: RelayEventMap['relay:chat:messages'] = messages;
      webContents.send('relay:chat:messages', payload);
    },

    setSessions(sessions) {
      const payload: RelayEventMap['relay:chat:sessions'] = sessions;
      webContents.send('relay:chat:sessions', payload);
    },

    setInputText(text) {
      webContents.send('relay:chat:input-text', text);
    },

    setSelectedSessionId(sessionId) {
      selectedSessionId = sessionId;
      webContents.send('relay:chat:selected-session', sessionId);
    },

    setLatestPromptTrace(trace) {
      const payload: RelayEventMap['relay:chat:prompt-trace'] = trace;
      webContents.send('relay:chat:prompt-trace', payload);
    },

    setLatestTurnAudit(audit) {
      const payload: RelayEventMap['relay:chat:turn-audit'] = audit;
      webContents.send('relay:chat:turn-audit', payload);
    },

    setStatusBanner(input) {
      const payload: RelayEventMap['relay:chat:status-banner'] = input;
      webContents.send('relay:chat:status-banner', payload);
    },

    setSendPhase(phase) {
      const payload: RelayEventMap['relay:chat:turn:phase'] = { phase };
      webContents.send('relay:chat:turn:phase', payload);
    },
  };
}
