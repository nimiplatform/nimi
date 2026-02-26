import type { RuntimeModality } from '../types/llm';

export type ModelTypeCategory = 'chat' | 'reasoning' | 'vision' | 'audio' | 'coding';

export type GroupedModelOptions = Array<{
  key: ModelTypeCategory;
  label: string;
  options: string[];
}>;

export type ModelScenario = RuntimeModality;

export const OPENROUTER_AUDIO_CHAT_MODELS = [
  'openai/gpt-audio-mini',
  'openai/gpt-audio',
  'openai/gpt-4o-audio-preview',
] as const;

export const OPENROUTER_TTS_MODELS = [
  'openai/gpt-4o-mini-tts',
  'openai/tts-1',
  'openai/tts-1-hd',
] as const;

export const IMAGE_MODEL_HINTS = [
  'image',
  'vision',
  'flux',
  'sdxl',
  'stable-diffusion',
  'dall-e',
  'recraft',
  'midjourney',
  'imagen',
] as const;

export const VIDEO_MODEL_HINTS = [
  'video',
  'sora',
  'veo',
  'kling',
  'runway',
  'hunyuan-video',
  'minimax-video',
  'luma',
  'wan',
] as const;

export const MODEL_TYPE_LABELS: Record<ModelTypeCategory, string> = {
  chat: 'General Chat',
  reasoning: 'Reasoning',
  vision: 'Vision / Multimodal',
  audio: 'Audio / Voice',
  coding: 'Coding',
};

export const MODEL_TYPE_ORDER: ModelTypeCategory[] = ['chat', 'reasoning', 'vision', 'audio', 'coding'];
