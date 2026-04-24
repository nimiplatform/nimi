import type { AgentChatExperienceSettings } from './chat-settings-storage';

export const AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID = 'nimi.agent.chat.message-action.v1' as const;

export type AgentResolvedTurnMode =
  | 'information'
  | 'emotional'
  | 'playful'
  | 'intimate'
  | 'checkin'
  | 'explicit-media'
  | 'explicit-voice';

export type AgentResolvedExperiencePolicy = {
  contentBoundary: 'default' | 'explicit-media-request';
  autonomyPolicy: 'guarded';
};

export type AgentResolvedMessage = {
  messageId: string;
  text: string;
};

export const AGENT_RESOLVED_STATUS_CUE_MOODS = [
  'neutral',
  'joy',
  'focus',
  'calm',
  'playful',
  'concerned',
  'surprised',
] as const;

export type AgentResolvedStatusCueMood = (typeof AGENT_RESOLVED_STATUS_CUE_MOODS)[number];

export type AgentResolvedStatusCue = {
  sourceMessageId: string;
  mood?: AgentResolvedStatusCueMood | null;
  label?: string | null;
  intensity?: number | null;
  actionCue?: string | null;
};

export type AgentResolvedModalityActionPromptPayload =
  | {
    kind: 'image-prompt';
    promptText: string;
  }
  | {
    kind: 'voice-prompt';
    promptText: string;
  };

export type AgentResolvedModalityAction = {
  actionId: string;
  actionIndex: number;
  actionCount: number;
  modality: 'image' | 'voice';
  operation: string;
  promptPayload: AgentResolvedModalityActionPromptPayload;
  sourceMessageId: string;
  deliveryCoupling: 'after-message' | 'with-message';
};

export type AgentResolvedMessageActionEnvelope = {
  schemaId: typeof AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID;
  message: AgentResolvedMessage;
  statusCue?: AgentResolvedStatusCue | null;
  actions: AgentResolvedModalityAction[];
};

export type AgentResolvedBehavior = {
  settings: AgentChatExperienceSettings;
  resolvedTurnMode: AgentResolvedTurnMode;
  resolvedExperiencePolicy: AgentResolvedExperiencePolicy;
};
