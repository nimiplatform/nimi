const PROVIDER_ALIASES = {
  local: 'local',
  localprovider: 'local',
  localsidecar: 'local',
  nimillm: 'nimillm',
  openai: 'openai',
  anthropic: 'anthropic',
  dashscope: 'dashscope',
  volcengine: 'volcengine',
  gemini: 'gemini',
  minimax: 'minimax',
  mimo: 'mimo',
  xiaomi: 'mimo',
  xiaomimimo: 'mimo',
  kimi: 'kimi',
  glm: 'glm',
  deepseek: 'deepseek',
  openrouter: 'openrouter',
  azure: 'azure',
  mistral: 'mistral',
  groq: 'groq',
  xai: 'xai',
  qianfan: 'qianfan',
  hunyuan: 'hunyuan',
  spark: 'spark',
  openaicompatible: 'openai_compatible',
  volcengineopenspeech: 'volcengine_openspeech',
  awspolly: 'aws_polly',
  azurespeech: 'azure_speech',
  googlecloudtts: 'google_cloud_tts',
  googleveo: 'google_veo',
  fishaudio: 'fish_audio',
};

export function canonicalProviderId(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!normalized) return '';
  if (Object.prototype.hasOwnProperty.call(PROVIDER_ALIASES, normalized)) {
    return PROVIDER_ALIASES[normalized];
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
