import type { ReactNode } from 'react';
import {
  NIMI_REALM_OAUTH_PROVIDER,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { resolveSocialOauthConfig } from '@nimiplatform/kit/auth';
import { desktopOAuthBridge } from '@renderer/features/auth/desktop-auth-adapter.js';
import { ICON_MAIL } from './settings-assets.js';
import { SectionTitle } from './settings-layout-components.js';

type ProfileOauthRow = {
  provider: NimiRealmOAuthProvider;
  label: string;
  subtitle: string;
  disabledReason: string;
  icon: ReactNode;
};

function buildProfileOauthRows(googleClientId: string): ProfileOauthRow[] {
  const twitterOauthConfig = resolveSocialOauthConfig('TWITTER', desktopOAuthBridge);
  const tikTokOauthConfig = resolveSocialOauthConfig('TIKTOK', desktopOAuthBridge);
  return [
    {
      provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
      label: 'Google',
      subtitle: 'google.com',
      disabledReason: googleClientId ? '' : 'Missing Google OAuth client ID',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      ),
    },
    {
      provider: NIMI_REALM_OAUTH_PROVIDER.TWITTER,
      label: 'Twitter',
      subtitle: 'x.com',
      disabledReason: twitterOauthConfig.enabled ? '' : twitterOauthConfig.disabledReason,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
    },
    {
      provider: NIMI_REALM_OAUTH_PROVIDER.TIKTOK,
      label: 'TikTok',
      subtitle: 'tiktok.com',
      disabledReason: tikTokOauthConfig.enabled ? '' : tikTokOauthConfig.disabledReason,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
        </svg>
      ),
    },
  ];
}

export function ProfileConnectedAccountsSection({
  connectedProviderSet,
  email,
  googleClientId,
  linkingProvider,
  onLinkProvider,
  onUnlinkProvider,
  unlinkingProvider,
}: {
  connectedProviderSet: ReadonlySet<NimiRealmOAuthProvider>;
  email: string;
  googleClientId: string;
  linkingProvider: NimiRealmOAuthProvider | null;
  onLinkProvider: (provider: NimiRealmOAuthProvider) => void;
  onUnlinkProvider: (provider: NimiRealmOAuthProvider) => void;
  unlinkingProvider: NimiRealmOAuthProvider | null;
}) {
  const { t } = useTranslation();
  const oauthRows = buildProfileOauthRows(googleClientId);
  return (
    <section className="mt-8">
      <SectionTitle description={t('Profile.connectedAccountsDescription')}>
        {t('Profile.sectionConnectedAccounts')}
      </SectionTitle>
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              {ICON_MAIL}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('Profile.email')}</p>
              <p className="text-xs text-gray-500">{email || t('Common.notConnected')}</p>
            </div>
          </div>
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            {t('Common.connected')}
          </span>
        </div>

        {oauthRows.map((row) => {
          const connected = connectedProviderSet.has(row.provider);
          const pending = linkingProvider === row.provider || unlinkingProvider === row.provider;
          const disabled = pending || (!connected && Boolean(row.disabledReason));
          const actionLabel = connected ? 'Disconnect' : t('Common.connect');
          return (
            <div key={row.provider}>
              <div className="h-px bg-gray-100 mx-5" />
              <div className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-700">
                    {row.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{row.label}</p>
                    <p className="text-xs text-gray-500">
                      {connected ? row.subtitle : t('Common.notConnected')}
                    </p>
                    {!connected && row.disabledReason ? (
                      <p className="mt-0.5 text-[11px] text-amber-600">{row.disabledReason}</p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (connected) {
                      onUnlinkProvider(row.provider);
                    } else {
                      onLinkProvider(row.provider);
                    }
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-mint-400 hover:text-mint-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? 'Working...' : actionLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
