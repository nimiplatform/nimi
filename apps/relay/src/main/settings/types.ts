// Relay settings types — adapted from local-chat default-settings-store.ts
// Removed: mod SDK dependencies (readRuntimeModSettings, writeRuntimeModSettings)

export type LocalChatTtsVoice = string;
export type LocalChatDeliveryStyle = 'natural' | 'compact';
export type LocalChatMediaAutonomy = 'off' | 'explicit-only' | 'natural';
export type LocalChatVoiceAutonomy = 'off' | 'explicit-only' | 'natural';
export type LocalChatVoiceConversationMode = 'off' | 'on';
export type LocalChatRelationshipBoundaryPreset = 'reserved' | 'balanced' | 'close';
export type LocalChatVisualComfortLevel = 'text-only' | 'restrained-visuals' | 'natural-visuals';

export const LOCAL_CHAT_TTS_VOICE_OPTIONS = [
  'alloy',
  'echo',
  'fable',
  'nova',
  'onyx',
  'shimmer',
] as const;

export type LocalChatBooleanSettingKey = 'allowProactiveContact' | 'autoPlayVoiceReplies';

export type LocalChatProductSettings = {
  mediaAutonomy: LocalChatMediaAutonomy;
  voiceAutonomy: LocalChatVoiceAutonomy;
  voiceConversationMode: LocalChatVoiceConversationMode;
  visualComfortLevel: LocalChatVisualComfortLevel;
  allowProactiveContact: boolean;
  autoPlayVoiceReplies: boolean;
};

export type LocalChatInspectSettings = {
  voiceName: LocalChatTtsVoice;
  diagnosticsVisible: boolean;
  runtimeInspectorVisible: boolean;
  ttsRouteSource: 'auto' | 'local' | 'cloud';
  ttsConnectorId: string;
  ttsModel: string;
  sttRouteSource: 'auto' | 'local' | 'cloud';
  sttConnectorId: string;
  sttModel: string;
  imageRouteSource: 'auto' | 'local' | 'cloud';
  imageConnectorId: string;
  imageModel: string;
  videoRouteSource: 'auto' | 'local' | 'cloud';
  videoConnectorId: string;
  videoModel: string;
};

export type LocalChatSettings = {
  product: LocalChatProductSettings;
  inspect: LocalChatInspectSettings;
};

export type LocalChatDefaultSettings = LocalChatProductSettings & LocalChatInspectSettings & {
  enableVoice: boolean;
  deliveryStyle: LocalChatDeliveryStyle;
  relationshipBoundaryPreset: LocalChatRelationshipBoundaryPreset;
};

export const DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS: LocalChatProductSettings = {
  mediaAutonomy: 'natural',
  voiceAutonomy: 'natural',
  voiceConversationMode: 'off',
  visualComfortLevel: 'natural-visuals',
  allowProactiveContact: true,
  autoPlayVoiceReplies: false,
};

export const DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS: LocalChatInspectSettings = {
  voiceName: '',
  diagnosticsVisible: true,
  runtimeInspectorVisible: false,
  ttsRouteSource: 'auto',
  ttsConnectorId: '',
  ttsModel: '',
  sttRouteSource: 'auto',
  sttConnectorId: '',
  sttModel: '',
  imageRouteSource: 'auto',
  imageConnectorId: '',
  imageModel: '',
  videoRouteSource: 'auto',
  videoConnectorId: '',
  videoModel: '',
};

export const DEFAULT_LOCAL_CHAT_SETTINGS: LocalChatSettings = {
  product: { ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS },
  inspect: { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS },
};

export function resolveLocalChatVoiceEnabled(
  input: Pick<LocalChatProductSettings, 'voiceAutonomy' | 'voiceConversationMode'>,
): boolean {
  return input.voiceConversationMode === 'on' || input.voiceAutonomy !== 'off';
}

export const DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS: LocalChatDefaultSettings = {
  enableVoice: resolveLocalChatVoiceEnabled(DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS),
  deliveryStyle: 'natural',
  relationshipBoundaryPreset: 'balanced',
  ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS,
  ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS,
};

export function normalizeLocalChatProductSettings(value: unknown): LocalChatProductSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  const normalizedMediaAutonomy = String(record.mediaAutonomy || '').trim();
  const normalizedVoiceAutonomy = String(record.voiceAutonomy || '').trim();
  const normalizedVoiceConversationMode = String(record.voiceConversationMode || '').trim();
  const mediaAutonomy = normalizedMediaAutonomy === 'off'
    || normalizedMediaAutonomy === 'explicit-only'
    ? normalizedMediaAutonomy
    : 'natural';
  const voiceAutonomy = normalizedVoiceAutonomy === 'off'
    || normalizedVoiceAutonomy === 'explicit-only'
    || normalizedVoiceAutonomy === 'natural'
    ? normalizedVoiceAutonomy
    : DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.voiceAutonomy;
  const voiceConversationMode = normalizedVoiceConversationMode === 'on'
    ? 'on'
    : 'off';
  const normalizedVisualComfort = String(record.visualComfortLevel || '').trim();
  const visualComfortLevel = normalizedVisualComfort === 'text-only'
    || normalizedVisualComfort === 'restrained-visuals'
    || normalizedVisualComfort === 'natural-visuals'
    ? normalizedVisualComfort
    : DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.visualComfortLevel;
  return {
    mediaAutonomy,
    voiceAutonomy,
    voiceConversationMode,
    visualComfortLevel,
    allowProactiveContact: record.allowProactiveContact !== false,
    autoPlayVoiceReplies: Boolean(record.autoPlayVoiceReplies),
  };
}

export function normalizeLocalChatInspectSettings(value: unknown): LocalChatInspectSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  const normalizedVoiceName = String(record.voiceName || '').trim();
  const voiceName = normalizedVoiceName || DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS.voiceName;
  const normalizedTtsRouteSource = String(record.ttsRouteSource || '').trim();
  const normalizedSttRouteSource = String(record.sttRouteSource || '').trim();
  const normalizedImageRouteSource = String(record.imageRouteSource || '').trim();
  const normalizedVideoRouteSource = String(record.videoRouteSource || '').trim();
  const ttsRouteSource = normalizedTtsRouteSource === 'local' || normalizedTtsRouteSource === 'cloud'
    ? normalizedTtsRouteSource
    : 'auto';
  const sttRouteSource = normalizedSttRouteSource === 'local' || normalizedSttRouteSource === 'cloud'
    ? normalizedSttRouteSource
    : 'auto';
  const imageRouteSource = normalizedImageRouteSource === 'local' || normalizedImageRouteSource === 'cloud'
    ? normalizedImageRouteSource
    : 'auto';
  const videoRouteSource = normalizedVideoRouteSource === 'local' || normalizedVideoRouteSource === 'cloud'
    ? normalizedVideoRouteSource
    : 'auto';
  const ttsConnectorId = String(record.ttsConnectorId || '').trim();
  const ttsModel = String(record.ttsModel || '').trim();
  const sttConnectorId = String(record.sttConnectorId || '').trim();
  const sttModel = String(record.sttModel || '').trim();
  const imageConnectorId = String(record.imageConnectorId || '').trim();
  const imageModel = String(record.imageModel || '').trim();
  const videoConnectorId = String(record.videoConnectorId || '').trim();
  const videoModel = String(record.videoModel || '').trim();
  return {
    voiceName,
    diagnosticsVisible: record.diagnosticsVisible !== false,
    runtimeInspectorVisible: Boolean(record.runtimeInspectorVisible),
    ttsRouteSource,
    ttsConnectorId,
    ttsModel,
    sttRouteSource,
    sttConnectorId,
    sttModel,
    imageRouteSource,
    imageConnectorId,
    imageModel,
    videoRouteSource,
    videoConnectorId,
    videoModel,
  };
}

export function normalizeLocalChatSettings(value: unknown): LocalChatSettings {
  if (!value || typeof value !== 'object') {
    return {
      product: { ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS },
      inspect: { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS },
    };
  }
  const record = value as Record<string, unknown>;
  return {
    product: normalizeLocalChatProductSettings(record.product),
    inspect: normalizeLocalChatInspectSettings(record.inspect),
  };
}

export function mergeLocalChatSettings(settings: LocalChatSettings): LocalChatDefaultSettings {
  return {
    ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
    ...settings.product,
    ...settings.inspect,
    enableVoice: resolveLocalChatVoiceEnabled(settings.product),
  };
}
