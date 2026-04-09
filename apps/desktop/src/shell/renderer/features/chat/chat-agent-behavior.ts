import type { AgentChatExperienceSettings } from './chat-settings-storage';

export const AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID = 'nimi.agent.chat.beat-action.v1' as const;

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

export type AgentResolvedBeat = {
  beatId: string;
  beatIndex: number;
  beatCount: number;
  intent: 'reply' | 'follow-up' | 'comfort' | 'checkin' | 'media-request' | 'voice-request';
  deliveryPhase: 'primary' | 'tail';
  delayMs?: number;
};

export type AgentResolvedTextBeat = AgentResolvedBeat & {
  text: string;
};

export type AgentResolvedModalityActionPromptPayload =
  | {
    kind: 'image-prompt';
    promptText: string;
  }
  | {
    kind: 'voice-prompt';
    promptText: string;
  }
  | {
    kind: 'video-prompt';
    promptText: string;
  };

export type AgentResolvedModalityAction = {
  actionId: string;
  actionIndex: number;
  actionCount: number;
  modality: 'image' | 'voice' | 'video';
  operation: string;
  promptPayload: AgentResolvedModalityActionPromptPayload;
  sourceBeatId: string;
  sourceBeatIndex: number;
  deliveryCoupling: 'after-source-beat' | 'with-source-beat';
};

export type AgentResolvedBeatActionEnvelope = {
  schemaId: typeof AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID;
  beats: AgentResolvedTextBeat[];
  actions: AgentResolvedModalityAction[];
};

export type AgentResolvedBeatPlan = {
  beats: AgentResolvedBeat[];
};

export type AgentResolvedBehavior = {
  settings: AgentChatExperienceSettings;
  resolvedTurnMode: AgentResolvedTurnMode;
  resolvedExperiencePolicy: AgentResolvedExperiencePolicy;
  resolvedBeatPlan: AgentResolvedBeatPlan;
};
