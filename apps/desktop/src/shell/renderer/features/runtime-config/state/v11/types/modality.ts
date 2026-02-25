export const CAPABILITIES_V11 = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityV11 = (typeof CAPABILITIES_V11)[number];

export type SourceIdV11 = 'local-runtime' | 'token-api';
export type RuntimeSectionIdV11 = 'setup';
export type RuntimeSetupPageIdV11 = 'overview' | 'models' | 'cloud-api' | 'providers';
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

export function normalizeSectionV11(value: unknown): RuntimeSectionIdV11 {
  void value;
  return 'setup';
}

export function normalizeSetupPageV11(value: unknown): RuntimeSetupPageIdV11 {
  if (value === 'cloud-api' || value === 'providers' || value === 'models') return value;
  if (value === 'token-api') return 'cloud-api';
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
