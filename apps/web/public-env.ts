export const WEB_PUBLIC_ENV_KEYS = Object.freeze([
  'VITE_NIMI_SHELL_MODE',
  'VITE_NIMI_REALM_BASE_URL',
  'VITE_NIMI_GOOGLE_CLIENT_ID',
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_WEB_BASE_URL',
  'VITE_LANDING_DEFAULT_LOCALE',
  'VITE_LANDING_APP_URL',
  'VITE_LANDING_WEB_APP_URL',
  'VITE_LANDING_DISCORD_URL',
  'VITE_LANDING_DOCS_URL',
  'VITE_LANDING_GITHUB_URL',
  'VITE_LANDING_PROTOCOL_URL',
  'VITE_LANDING_DESKTOP_DOWNLOAD_URL',
  'VITE_NIMI_DEBUG_BOOT',
  'VITE_NIMI_VERBOSE_RENDERER_LOGS',
] as const);

export type WebPublicEnvKey = (typeof WEB_PUBLIC_ENV_KEYS)[number];
export type WebPublicEnv = Readonly<Partial<Record<WebPublicEnvKey, string>>>;

const LOCAL_DIAGNOSTIC_KEYS = new Set<WebPublicEnvKey>([
  'VITE_NIMI_DEBUG_BOOT',
  'VITE_NIMI_VERBOSE_RENDERER_LOGS',
]);
const FIXED_OR_DERIVED_KEYS = new Set<WebPublicEnvKey>([
  'VITE_NIMI_SHELL_MODE',
  'VITE_NIMI_REALM_BASE_URL',
]);
const FORBIDDEN_PUBLIC_KEY_PATTERN = /(TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL)/i;

for (const key of WEB_PUBLIC_ENV_KEYS) {
  if (FORBIDDEN_PUBLIC_KEY_PATTERN.test(key)) {
    throw new Error(`Forbidden client environment key in Web public allowlist: ${key}`);
  }
}

export function resolveWebPublicEnv(input: {
  readonly source: Readonly<Record<string, string | undefined>>;
  readonly realmProxyTarget: string | null;
  readonly mode: string;
}): WebPublicEnv {
  const resolved: Partial<Record<WebPublicEnvKey, string>> = {
    VITE_NIMI_SHELL_MODE: 'web',
  };
  if (input.realmProxyTarget) {
    resolved.VITE_NIMI_REALM_BASE_URL = input.realmProxyTarget;
  }
  for (const key of WEB_PUBLIC_ENV_KEYS) {
    if (FIXED_OR_DERIVED_KEYS.has(key)) continue;
    if (input.mode === 'production' && LOCAL_DIAGNOSTIC_KEYS.has(key)) continue;
    const value = String(input.source[key] || '').trim();
    if (value) resolved[key] = value;
  }
  return Object.freeze(resolved);
}

export function createWebPublicEnvDefines(env: WebPublicEnv): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    WEB_PUBLIC_ENV_KEYS.map((key) => [
      `import.meta.env.${key}`,
      JSON.stringify(env[key] || ''),
    ]),
  ));
}
