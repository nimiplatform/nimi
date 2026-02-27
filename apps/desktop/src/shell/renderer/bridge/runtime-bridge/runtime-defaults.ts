import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import { parseRuntimeDefaults, type RuntimeDefaults } from './types';

function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const processEnv =
    typeof globalThis.process !== 'undefined'
      ? ((globalThis.process as { env?: Record<string, string> }).env ?? {})
      : {};
  return String(importMetaEnv?.[name] || processEnv[name] || '').trim();
}

function resolveShellMode(): 'desktop' | 'web' {
  const raw = String(readEnv('VITE_NIMI_SHELL_MODE') || '').toLowerCase();
  if (raw === 'desktop' || raw === 'web') {
    return raw;
  }
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  return hasTauriInvoke() ? 'desktop' : 'web';
}

function resolveBrowserOrigin(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return String(window.location?.origin || '').trim();
}

function resolveApiBaseUrlFallback(): string {
  const browserOrigin = resolveBrowserOrigin();
  // Web shell must always use same-origin API routing (nginx/reverse-proxy friendly).
  if (resolveShellMode() === 'web') {
    return browserOrigin;
  }
  return readEnv('NIMI_REALM_URL') || 'http://localhost:3002';
}

function readRuntimeDefaultsFallback(): RuntimeDefaults {
  const apiBaseUrl = resolveApiBaseUrlFallback();
  const realtimeUrl = readEnv('NIMI_REALTIME_URL');
  const accessToken = readEnv('NIMI_ACCESS_TOKEN');
  const localProviderEndpoint = readEnv('NIMI_LOCAL_PROVIDER_ENDPOINT') || 'http://127.0.0.1:1234/v1';
  const localProviderModel = readEnv('NIMI_LOCAL_PROVIDER_MODEL') || 'local-model';
  const localOpenAiEndpoint = readEnv('NIMI_LOCAL_OPENAI_ENDPOINT') || 'http://127.0.0.1:1234/v1';
  const localOpenAiApiKey = readEnv('NIMI_LOCAL_OPENAI_API_KEY');
  const targetType = readEnv('NIMI_TARGET_TYPE') || 'AGENT';
  const targetAccountId = readEnv('NIMI_TARGET_ACCOUNT_ID');
  const agentId = readEnv('NIMI_AGENT_ID');
  const worldId = readEnv('NIMI_WORLD_ID');
  const provider = readEnv('NIMI_PROVIDER');
  const userConfirmedUpload = readEnv('NIMI_USER_CONFIRMED_UPLOAD') === '1';
  return {
    apiBaseUrl,
    realtimeUrl,
    accessToken,
    localProviderEndpoint,
    localProviderModel,
    localOpenAiEndpoint,
    localOpenAiApiKey,
    targetType,
    targetAccountId,
    agentId,
    worldId,
    provider,
    userConfirmedUpload,
  };
}

export async function getRuntimeDefaults() {
  if (!hasTauriInvoke()) {
    return readRuntimeDefaultsFallback();
  }

  return invokeChecked('runtime_defaults', {}, parseRuntimeDefaults);
}
