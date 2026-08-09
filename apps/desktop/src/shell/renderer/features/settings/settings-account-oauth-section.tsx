import type { ReactNode } from 'react';
import {
  NIMI_REALM_OAUTH_PROVIDER,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { ICON_MAIL } from './settings-assets.js';
import {
  Button,
  Card,
  Section,
  SettingRow,
  StatusBadge,
} from './settings-layout-components.js';
import { profileOauthPlatform } from './profile-oauth-platform.js';

type ProfileOauthRow = {
  provider: NimiRealmOAuthProvider;
  label: string;
  subtitle: string;
  /** i18n key for the user-facing disabled reason; render via t(). */
  disabledReason: string;
  icon: ReactNode;
};

function buildProfileOauthRows(): ProfileOauthRow[] {
  return [
    {
      provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
      label: 'Google',
      subtitle: 'google.com',
      disabledReason: profileOauthPlatform.availability(NIMI_REALM_OAUTH_PROVIDER.GOOGLE).disabledReason,
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
      provider: NIMI_REALM_OAUTH_PROVIDER.TIKTOK,
      label: 'TikTok',
      subtitle: 'tiktok.com',
      disabledReason: profileOauthPlatform.availability(NIMI_REALM_OAUTH_PROVIDER.TIKTOK).disabledReason,
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
  linkingProvider,
  onLinkProvider,
  onUnlinkProvider,
  unlinkingProvider,
}: {
  connectedProviderSet: ReadonlySet<NimiRealmOAuthProvider>;
  email: string;
  linkingProvider: NimiRealmOAuthProvider | null;
  onLinkProvider: (provider: NimiRealmOAuthProvider) => void;
  onUnlinkProvider: (provider: NimiRealmOAuthProvider) => void;
  unlinkingProvider: NimiRealmOAuthProvider | null;
}) {
  const { t } = useTranslation();
  const oauthRows = buildProfileOauthRows();
  return (
    <Section
      title={t('Profile.sectionConnectedAccounts')}
      description={t('Profile.connectedAccountsDescription')}
    >
      <Card>
        <div className="flex flex-col divide-y divide-[var(--nimi-border-subtle)]">
          <SettingRow
            icon={ICON_MAIL}
            title={t('Profile.email')}
            description={email || t('Common.notConnected')}
            control={<StatusBadge status="success" text={t('Common.connected')} />}
          />
          {oauthRows.map((row) => {
            const connected = connectedProviderSet.has(row.provider);
            const pending = linkingProvider === row.provider || unlinkingProvider === row.provider;
            const disabled = pending || (!connected && Boolean(row.disabledReason));
            const description = connected
              ? row.subtitle
              : row.disabledReason
                ? t(row.disabledReason)
                : t('Common.notConnected');
            return (
              <SettingRow
                key={row.provider}
                icon={row.icon}
                title={row.label}
                description={description}
                control={(
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      if (connected) {
                        onUnlinkProvider(row.provider);
                      } else {
                        onLinkProvider(row.provider);
                      }
                    }}
                  >
                    {pending ? t('Common.working') : connected ? t('Common.disconnect') : t('Common.connect')}
                  </Button>
                )}
              />
            );
          })}
        </div>
      </Card>
    </Section>
  );
}
