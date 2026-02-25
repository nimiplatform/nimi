import {
  IMAGE_MODEL_HINTS,
  OPENROUTER_AUDIO_CHAT_MODELS,
  OPENROUTER_TTS_MODELS,
  VIDEO_MODEL_HINTS,
  type ModelTypeCategory,
} from './presets';

function hasAnyHint(modelId: string, hints: readonly string[]): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  return hints.some((hint) => normalized.includes(hint));
}

export function classifyModelType(modelId: string): ModelTypeCategory {
  const normalized = String(modelId || '').toLowerCase();

  if (/(audio|speech|voice|tts|realtime|whisper|transcrib|asr)/.test(normalized)) {
    return 'audio';
  }

  if (/(vision|image|video|vl|multimodal|omni)/.test(normalized)) {
    return 'vision';
  }

  if (/(reason|reasoner|thinking|think|r1\b|o1\b|o3\b)/.test(normalized)) {
    return 'reasoning';
  }

  if (/(coder|coding|code)/.test(normalized)) {
    return 'coding';
  }

  return 'chat';
}

export function isLikelyTtsModel(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  if ((OPENROUTER_TTS_MODELS as readonly string[]).includes(normalized)) return true;
  return (
    normalized.includes('tts')
    || normalized.includes('text-to-speech')
    || normalized.includes('audio')
    || normalized.includes('voice')
    || normalized.includes('speech')
  );
}

export function isLikelySttModel(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  return (
    normalized.includes('whisper')
    || normalized.includes('transcribe')
    || normalized.includes('transcription')
    || normalized.includes('speech-to-text')
    || normalized.includes('asr')
  );
}

export function isLikelyEmbeddingModel(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  return (
    normalized.includes('embedding')
    || normalized.includes('text-embedding')
    || normalized.includes('embed')
  );
}

export function isLikelyImageModel(modelId: string): boolean {
  return hasAnyHint(modelId, IMAGE_MODEL_HINTS);
}

export function isLikelyVideoModel(modelId: string): boolean {
  return hasAnyHint(modelId, VIDEO_MODEL_HINTS);
}

export function isLikelyAudioChatModel(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  if ((OPENROUTER_AUDIO_CHAT_MODELS as readonly string[]).includes(normalized)) return true;
  return normalized.includes('audio') || normalized.includes('native-audio') || normalized.includes('omni');
}
