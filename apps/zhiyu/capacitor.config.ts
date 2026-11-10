import type { CapacitorConfig } from '@capacitor/cli';
import type { NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';

// Development inputs only. This client must be admitted separately; these
// values neither grant access nor establish Android domain verification.
export const mobileAccess: Omit<NimiRemoteAppConfig, 'fetch'> = {
  appId: 'nimi.zhiyu', clientId: 'nimi.zhiyu.android.dev', realmEnvironmentId: 'dev',
  realmBaseUrl: 'http://127.0.0.1:3002', officialWebBaseUrl: 'http://localhost:3000',
  redirectUri: 'ai.nimi.apps.zhiyu.dev:/oauth/callback',
};
const config: CapacitorConfig = {
  appId: 'ai.nimi.apps.zhiyu.dev', appName: '织羽', webDir: 'dist-mobile', loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  plugins: { NimiAppAccess: { realmBaseUrl: mobileAccess.realmBaseUrl, clientId: mobileAccess.clientId } },
};
export default config;
