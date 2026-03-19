// RL-PIPE-001 — Chat pipeline state consumed by renderer
// Beat-first messages, turn phases, voice state

import { create } from 'zustand';
import type { JsonObject } from '../../../shared/json.js';

export type ChatMessageKind =
  | 'text'
  | 'voice'
  | 'image'
  | 'video'
  | 'image-pending'
  | 'video-pending'
  | 'streaming';

export type ChatMessageMedia = {
  uri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  previewUri?: string;
};

export type ChatMessageMeta = JsonObject;

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  kind: ChatMessageKind;
  content: string;
  media?: ChatMessageMedia;
  timestamp: string | Date;
  latencyMs?: number;
  meta?: ChatMessageMeta;
};

export type TurnSendPhase =
  | 'idle'
  | 'awaiting-first-beat'
  | 'streaming-first-beat'
  | 'planning-tail'
  | 'delivering-tail';

export type StatusBanner = {
  kind: 'warning' | 'error' | 'success' | 'info';
  message: string;
} | null;

export interface ChatState {
  messages: ChatMessage[];
  sendPhase: TurnSendPhase;
  statusBanner: StatusBanner;
  promptTrace: unknown | null;
  turnAudit: unknown | null;

  setMessages: (messages: ChatMessage[]) => void;
  setSendPhase: (phase: TurnSendPhase) => void;
  setStatusBanner: (banner: StatusBanner) => void;
  setPromptTrace: (trace: unknown | null) => void;
  setTurnAudit: (audit: unknown | null) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sendPhase: 'idle',
  statusBanner: null,
  promptTrace: null,
  turnAudit: null,

  setMessages: (messages) => set({ messages }),
  setSendPhase: (sendPhase) => set({ sendPhase }),
  setStatusBanner: (statusBanner) => set({ statusBanner }),
  setPromptTrace: (promptTrace) => set({ promptTrace }),
  setTurnAudit: (turnAudit) => set({ turnAudit }),
  clearChat: () => set({ messages: [], sendPhase: 'idle', statusBanner: null, promptTrace: null, turnAudit: null }),
}));
