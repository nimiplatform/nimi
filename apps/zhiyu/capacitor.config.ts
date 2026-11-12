import type { CapacitorConfig } from '@capacitor/cli';
import type { NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.android-entry
export const mobileRelease = process.env.NIMI_ANDROID_RELEASE === '1';
const debugPackage = 'ai.nimi.apps.zhiyu.dev';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value !== value.trim()) throw new Error(`Set ${name} for the Android release.`);
  return value;
}

function releaseUrl(name: string, originOnly = true): string {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || /^(?:localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u.test(url.hostname)
    || value !== (originOnly ? url.origin : url.href)) {
    throw new Error(`${name} must be an exact deployed HTTPS ${originOnly ? 'origin' : 'callback'}.`);
  }
  return value;
}

const androidPackage = mobileRelease ? required('NIMI_ANDROID_PACKAGE_NAME') : debugPackage;
if (mobileRelease && (androidPackage === debugPackage || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(androidPackage))) {
  throw new Error('NIMI_ANDROID_PACKAGE_NAME must identify the release application.');
}

export const mobileAccess: Omit<NimiRemoteAppConfig, 'fetch'> = mobileRelease ? {
  appId: 'nimi.zhiyu', clientId: required('NIMI_ANDROID_CLIENT_ID'),
  realmEnvironmentId: required('NIMI_ANDROID_REALM_ENVIRONMENT_ID'),
  realmBaseUrl: releaseUrl('NIMI_ANDROID_REALM_URL'), officialWebBaseUrl: releaseUrl('NIMI_ANDROID_OFFICIAL_WEB_URL'),
  redirectUri: releaseUrl('NIMI_ANDROID_REDIRECT_URI', false),
} : {
  appId: 'nimi.zhiyu', clientId: 'nimi.zhiyu.android.dev', realmEnvironmentId: 'dev',
  realmBaseUrl: 'http://127.0.0.1:3002', officialWebBaseUrl: 'http://localhost:3000',
  redirectUri: 'ai.nimi.apps.zhiyu.dev:/oauth/callback',
};
const config: CapacitorConfig = {
  appId: androidPackage, appName: '织羽', webDir: mobileRelease ? 'dist-mobile-release' : 'dist-mobile', loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  plugins: { NimiAppAccess: { realmBaseUrl: mobileAccess.realmBaseUrl, clientId: mobileAccess.clientId, redirectUri: mobileAccess.redirectUri } },
};
export default config;
