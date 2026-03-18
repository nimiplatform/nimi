import { OAuthProvider } from '@nimiplatform/sdk/realm';
import { desktopBridge } from '@renderer/bridge';
import {
  startSocialOauth as startSocialOauthCore,
  resolveSocialOauthConfig as resolveSocialOauthConfigCore,
  type SocialOauthProvider,
  type SocialOauthConfig,
  type TauriOAuthBridge,
} from '@nimiplatform/shell-core/oauth';

export type { SocialOauthProvider, SocialOauthConfig };

const desktopOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke: () => desktopBridge.hasTauriInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  oauthTokenExchange: (payload) => desktopBridge.oauthTokenExchange(payload),
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

export function resolveSocialOauthConfig(provider: SocialOauthProvider): SocialOauthConfig {
  return resolveSocialOauthConfigCore(provider, desktopOAuthBridge);
}

export async function startSocialOauth(provider: SocialOauthProvider) {
  return startSocialOauthCore(provider, desktopOAuthBridge);
}

export function toOauthProvider(provider: SocialOauthProvider): OAuthProvider {
  return provider === 'TWITTER' ? OAuthProvider.TWITTER : OAuthProvider.TIKTOK;
}
