import type { JsonObject } from '../../shared/json.js';
import type { ChatMessage, VoiceConversationMode } from './types.js';

export type ChatRouteSnapshot = {
  source: string;
  model: string;
  connectorId?: string;
  provider?: string;
  localModelId?: string;
};

export type LocalChatGenerateTextInput = {
  prompt: string;
  model?: string;
  route?: string;
  maxTokens?: number;
  temperature?: number;
  agentId?: string;
  subjectUserId?: string;
  abortSignal?: AbortSignal;
  debugLabel?: string;
};

export type LocalChatGenerateTextResult = {
  text: string;
  traceId: string;
  finishReason?: string;
};

export type LocalChatGenerateObjectInput = LocalChatGenerateTextInput & {
  schema?: unknown;
  debugLabel?: string;
};

export type LocalChatGenerateObjectResult<T = unknown> = {
  object: T;
  text: string;
  traceId: string;
};

export type LocalChatStreamTextDelta =
  | { type: 'text_delta'; textDelta: string }
  | { type: 'done'; traceId: string; finishReason: string };

export type LocalChatGenerateImageInput = {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  n?: number;
  agentId?: string;
};

export type LocalChatGenerateImageResult = {
  artifacts: Array<{ uri?: string; base64?: string; mimeType?: string }>;
  traceId: string;
};

export type LocalChatGenerateVideoInput = {
  prompt: string;
  model?: string;
  content?: string;
  mode?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  cameraMotion?: string;
  agentId?: string;
};

export type LocalChatGenerateVideoResult = {
  artifacts: Array<{ uri?: string; base64?: string; mimeType?: string }>;
  traceId: string;
};

export type LocalChatAudioPlaybackSource = {
  uri?: string;
  bytes?: Uint8Array;
  mimeType?: string;
};

export type LocalChatTurnAiClient = {
  generateText(input: LocalChatGenerateTextInput): Promise<LocalChatGenerateTextResult>;
  generateObject<T = unknown>(input: LocalChatGenerateObjectInput): Promise<LocalChatGenerateObjectResult<T>>;
  streamText(input: LocalChatGenerateTextInput): AsyncIterable<LocalChatStreamTextDelta>;
  generateImage(input: LocalChatGenerateImageInput): Promise<LocalChatGenerateImageResult>;
  generateVideo(input: LocalChatGenerateVideoInput): Promise<LocalChatGenerateVideoResult>;
  resolveRoute(input: { routeBinding?: unknown }): Promise<ChatRouteSnapshot | null>;
};

export type LocalChatTarget = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  dna: {
    identityLines: string[];
    rulesLines: string[];
    replyStyleLines: string[];
  };
  metadata: JsonObject;
  worldId: string | null;
  worldName: string | null;
};

export type RelayChatTurnSendInput = {
  aiClient: LocalChatTurnAiClient;
  inputText: string;
  viewerId: string;
  viewerDisplayName: string;
  runtimeMode: 'STORY' | 'SCENE_TURN' | undefined;
  routeSnapshot: ChatRouteSnapshot | null;
  defaultSettings: import('../settings/types.js').LocalChatDefaultSettings;
  voiceConversationMode?: VoiceConversationMode;
  selectedTarget: LocalChatTarget | null;
  selectedSessionId: string;
  messages: ChatMessage[];
  isTranscribing?: boolean;
  onSessionResolved?: (sessionId: string) => void;
  synthesizeVoice?: (text: string) => Promise<LocalChatAudioPlaybackSource>;
};
