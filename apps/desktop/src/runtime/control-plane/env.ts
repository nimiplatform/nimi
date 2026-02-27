const DEFAULT_CONTROL_PLANE_BASE_URL = 'http://localhost';

type RuntimeEnvMap = Record<string, string | undefined>;

function getRuntimeEnvMap(): RuntimeEnvMap {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const processEnv =
    typeof process !== 'undefined' ? ((process as { env?: Record<string, string> }).env ?? {}) : {};
  return {
    ...importMetaEnv,
    ...processEnv,
  };
}

function getRuntimeEnv(name: string): string | undefined {
  return getRuntimeEnvMap()[name];
}

export function resolveControlPlaneRuntimeConfig(input: {
  controlPlaneBaseUrl?: string;
  accessToken?: string;
}): {
  baseUrl: string;
  accessToken: string;
} {
  const runtimeControlPlaneBaseUrl = getRuntimeEnv('NIMI_CONTROL_PLANE_URL');
  const runtimeAccessToken = getRuntimeEnv('NIMI_ACCESS_TOKEN');
  return {
    baseUrl: String(
      input.controlPlaneBaseUrl || runtimeControlPlaneBaseUrl || DEFAULT_CONTROL_PLANE_BASE_URL,
    ),
    accessToken: String(input.accessToken || runtimeAccessToken || ''),
  };
}

export { DEFAULT_CONTROL_PLANE_BASE_URL };
