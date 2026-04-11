import { getRuntimeDefaults } from '@nimiplatform/nimi-kit/shell/renderer/bridge';
import type { ParentOSRuntimeDefaults } from './parentos-types.js';

function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const processEnv =
    typeof globalThis.process !== 'undefined'
      ? ((globalThis.process as { env?: Record<string, string> }).env ?? {})
      : {};
  return String(importMetaEnv?.[name] || processEnv[name] || '').trim();
}

function normalizeLoopbackHttpUrl(rawValue: string, defaultPort: number): string {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || '').toLowerCase();
    const hasExplicitPort = String(parsed.port || '').trim().length > 0;
    const isLoopbackHttp = parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
    if (isLoopbackHttp && !hasExplicitPort) {
      parsed.port = String(defaultPort);
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function resolveWebBaseUrl(): string {
  return normalizeLoopbackHttpUrl(readEnv('NIMI_WEB_URL') || 'http://localhost:3000', 3000);
}

export async function getParentOSRuntimeDefaults(): Promise<ParentOSRuntimeDefaults> {
  const shared = await getRuntimeDefaults();
  return {
    ...shared,
    webBaseUrl: resolveWebBaseUrl(),
  };
}
