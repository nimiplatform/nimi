import type { CapacitorConfig } from '@capacitor/cli';
import type { NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';
import { resolveDevelopmentRealm } from '@nimiplatform/app-tools/development';

// @nimi-authority: rule.nimi.platform.remote-clients.development-source
export function readMobileConfiguration(env: Record<string, string | undefined> = process.env) {
  const mobileRelease = env.NIMI_ANDROID_RELEASE === '1';
  const realm = resolveDevelopmentRealm(undefined, env);
  const debugPackage = 'ai.nimi.apps.zhiyu.dev';
  const required = (name: string) => {
    const value = env[name];
    if (!value || value !== value.trim()) throw new Error(`Set ${name} to the registered Android source value.`);
    return value;
  };
  const https = (value: string, label: string, originOnly = true) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || /^(?:localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u.test(url.hostname)
      || value !== (originOnly ? url.origin : url.href)) throw new Error(`${label} requires an exact deployed HTTPS URL.`);
    return value;
  };
  const androidPackage = mobileRelease ? required('NIMI_ANDROID_PACKAGE_NAME') : (env.NIMI_ANDROID_PACKAGE_NAME || debugPackage);
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(androidPackage) || (mobileRelease && androidPackage === debugPackage)) {
    throw new Error('NIMI_ANDROID_PACKAGE_NAME must identify the selected Android application.');
  }
  const mobileAccess: Omit<NimiRemoteAppConfig, 'fetch'> = mobileRelease ? {
    appId: 'nimi.zhiyu', clientId: required('NIMI_ANDROID_CLIENT_ID'),
    realmEnvironmentId: required('NIMI_ANDROID_REALM_ENVIRONMENT_ID'),
    realmBaseUrl: https(required('NIMI_ANDROID_REALM_URL'), 'NIMI_ANDROID_REALM_URL'),
    officialWebBaseUrl: https(required('NIMI_ANDROID_OFFICIAL_WEB_URL'), 'NIMI_ANDROID_OFFICIAL_WEB_URL'),
    redirectUri: https(required('NIMI_ANDROID_REDIRECT_URI'), 'NIMI_ANDROID_REDIRECT_URI', false),
  } : realm.name === 'local' ? {
    appId: 'nimi.zhiyu', clientId: env.NIMI_ANDROID_CLIENT_ID || 'nimi.zhiyu.android.dev', realmEnvironmentId: realm.environmentId,
    realmBaseUrl: realm.apiOrigin, officialWebBaseUrl: realm.webOrigin,
    redirectUri: env.NIMI_ANDROID_REDIRECT_URI || `${debugPackage}:/oauth/callback`,
  } : {
    appId: 'nimi.zhiyu', clientId: required('NIMI_ANDROID_CLIENT_ID'), realmEnvironmentId: realm.environmentId,
    realmBaseUrl: realm.apiOrigin, officialWebBaseUrl: realm.webOrigin,
    redirectUri: https(required('NIMI_ANDROID_REDIRECT_URI'), 'NIMI_ANDROID_REDIRECT_URI', false),
  };
  const config: CapacitorConfig = {
    appId: androidPackage, appName: '织羽', webDir: mobileRelease ? 'dist-mobile-release' : 'dist-mobile', loggingBehavior: 'none',
    server: { androidScheme: 'https' },
    plugins: { NimiAppAccess: { realmBaseUrl: mobileAccess.realmBaseUrl, clientId: mobileAccess.clientId, redirectUri: mobileAccess.redirectUri } },
  };
  return { config, mobileAccess, mobileRelease };
}
