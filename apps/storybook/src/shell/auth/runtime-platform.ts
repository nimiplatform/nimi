import { createNimiAppRuntimePlatformClient, type NimiAppAuthMode, type NimiAppAuthProjection } from '@nimiplatform/sdk';

export const appId = 'nimi.storybook';
export const appTitle = 'Storybook';
export const scaffoldProfile = 'standalone' as const;
export const runtimeAccountLoginEnabled = true;

type RuntimeEnv = Record<string, string | boolean | undefined>;

let runtimeProjection: Promise<NimiAppAuthProjection> | null = null;

function runtimeEnv(): RuntimeEnv {
  return ((import.meta as ImportMeta & { env?: RuntimeEnv }).env || {});
}

function resolveRuntimeAuthMode(): NimiAppAuthMode {
  // Single connection model: a local dev app connects exactly the way a shipped
  // app does — through runtime account login. There is no separate standalone
  // developer-session mode; the runtime developer-registration gate (driven by
  // the desktop Developer Mode toggle) is what admits a not-yet-admitted local
  // app, not a parallel auth path.
  return runtimeAccountLoginEnabled ? 'local-first-party' : 'third-party-nimi-app';
}

export function clearRuntimePlatformProjection() {
  runtimeProjection = null;
}

export function getRuntimePlatformProjection() {
  const env = runtimeEnv();
  const mode = resolveRuntimeAuthMode();

  if (mode === 'local-first-party') {
    // K-AUTHSVC-014: in a local dev build (`vite dev`), declare developer
    // registration so a not-yet-admitted local app can register once the
    // desktop Developer Mode / local app testing gate is on. Production builds
    // (`vite build`) leave this false and follow normal admission.
    runtimeProjection ??= createNimiAppRuntimePlatformClient({
      mode: 'local-first-party',
      appId,
      developerRegistration: env.DEV === true,
    });
    return runtimeProjection;
  }

  runtimeProjection ??= createNimiAppRuntimePlatformClient({
    mode: 'third-party-nimi-app',
    appId,
  });
  return runtimeProjection;
}
