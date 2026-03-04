export const CAPABILITIES_V11 = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityV11 = (typeof CAPABILITIES_V11)[number];

export type SourceIdV11 = 'local-runtime' | 'token-api';
export type RuntimePageIdV11 = 'overview' | 'local' | 'cloud' | 'runtime' | 'mods';
export type RuntimeSetupPageIdV11 = RuntimePageIdV11;
export type UiModeV11 = 'simple' | 'advanced';
export type ProviderStatusV11 = 'idle' | 'healthy' | 'unreachable' | 'unsupported' | 'degraded';
export type ApiVendor =
  | 'openrouter'
  | 'gpt'
  | 'claude'
  | 'gemini'
  | 'kimi'
  | 'deepseek'
  | 'volcengine'
  | 'dashscope'
  | 'custom';

export function normalizeSourceV11(value: unknown): SourceIdV11 {
  return value === 'token-api' ? 'token-api' : 'local-runtime';
}

export function normalizePageIdV11(value: unknown): RuntimePageIdV11 {
  if (value === 'overview' || value === 'local' || value === 'cloud' || value === 'runtime' || value === 'mods') {
    return value;
  }
  return 'overview';
}

export function normalizeCapabilityV11(value: unknown): CapabilityV11 {
  if (value === 'image' || value === 'video' || value === 'tts' || value === 'stt' || value === 'embedding') return value;
  return 'chat';
}

export function normalizeUiModeV11(value: unknown): UiModeV11 {
  return value === 'advanced' ? 'advanced' : 'simple';
}

export function normalizeVendorV11(value: unknown): ApiVendor {
  if (
    value === 'gpt'
    || value === 'claude'
    || value === 'gemini'
    || value === 'kimi'
    || value === 'deepseek'
    || value === 'volcengine'
    || value === 'dashscope'
    || value === 'custom'
    || value === 'openrouter'
  ) {
    return value;
  }

  return 'openrouter';
}

export function normalizeStatusV11(value: unknown): ProviderStatusV11 {
  if (value === 'healthy' || value === 'unreachable' || value === 'unsupported' || value === 'degraded') return value;
  return 'idle';
}

export function statusTextV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'unsupported') return 'Unsupported';
  return 'Not checked';
}

export function statusClassV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'bg-green-50 text-green-700';
  if (status === 'degraded') return 'bg-yellow-50 text-yellow-700';
  if (status === 'unreachable') return 'bg-red-50 text-red-700';
  if (status === 'unsupported') return 'bg-orange-50 text-orange-700';
  return 'bg-gray-100 text-gray-600';
}
