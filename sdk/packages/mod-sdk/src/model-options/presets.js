export const OPENROUTER_AUDIO_CHAT_MODELS = [
    'openai/gpt-audio-mini',
    'openai/gpt-audio',
    'openai/gpt-4o-audio-preview',
];
export const OPENROUTER_TTS_MODELS = [
    'openai/gpt-4o-mini-tts',
    'openai/tts-1',
    'openai/tts-1-hd',
];
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
];
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
];
export const MODEL_TYPE_LABELS = {
    chat: 'General Chat',
    reasoning: 'Reasoning',
    vision: 'Vision / Multimodal',
    audio: 'Audio / Voice',
    coding: 'Coding',
};
export const MODEL_TYPE_ORDER = ['chat', 'reasoning', 'vision', 'audio', 'coding'];
