import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { changeLocale, getCurrentLocale, SUPPORTED_LOCALES, getLocaleLabel, type SupportedLocale } from '@renderer/i18n';
import type { GoogleWindow } from '@renderer/features/auth/auth-helpers.js';
import { getGoogleClientId, loadGoogleScript } from '@renderer/features/auth/auth-helpers.js';
import {
  resolveSocialOauthConfig,
  startSocialOauth,
} from '@renderer/features/auth/social-oauth.js';
import {
  BIO_MAX,
  ICON_CAMERA,
  ICON_MAIL,
  ICON_USER,
} from './settings-assets';
import {
  PageShell,
  SaveFooter,
  SectionTitle,
} from './settings-layout-components';
// SelectField component removed - settings now use unified custom dropdowns

// Icons
function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.auth.user);
  const authToken = useAppStore((s) => s.auth.token);
  const authRefreshToken = useAppStore((s) => s.auth.refreshToken);
  const setAuthSession = useAppStore((s) => s.setAuthSession);
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const displayName = String(user?.displayName || user?.handle || 'User');
  const userHandle = String(user?.handle || 'me');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;

  const [name, setName] = useState(displayName);
  const email = String(user?.email || '');
  const [bio, setBio] = useState(String(user?.bio || t('Profile.bioPlaceholder')));
  const [saving, setSaving] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null);
  const connectedProviders = Array.isArray(user?.oauthProviders)
    ? user.oauthProviders.filter((item): item is OAuthProvider => (
      item === OAuthProvider.GOOGLE || item === OAuthProvider.TWITTER || item === OAuthProvider.TIKTOK
    ))
    : [];
  const connectedProviderSet = new Set<OAuthProvider>(connectedProviders);
  const twitterOauthConfig = resolveSocialOauthConfig('TWITTER');
  const tikTokOauthConfig = resolveSocialOauthConfig('TIKTOK');
  const googleClientId = getGoogleClientId();

  const refreshCurrentUser = async () => {
    const latest = await dataSync.loadCurrentUser();
    const updatedUser = latest && typeof latest === 'object'
      ? (latest as Record<string, unknown>)
      : null;
    setAuthSession(updatedUser, authToken, authRefreshToken || undefined);
  };

  const requestGoogleAccessToken = async (): Promise<string> => {
    const clientId = String(googleClientId || '').trim();
    if (!clientId) {
      throw new Error(t('Profile.googleOauthClientIdMissing'));
    }
    await loadGoogleScript();
    const win = window as GoogleWindow;
    const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
    if (!initTokenClient) {
      throw new Error(t('Profile.googleOauthInitFailed'));
    }
    return new Promise((resolve, reject) => {
      const tokenClient = initTokenClient({
        client_id: clientId,
        scope: 'email profile openid',
        callback: (tokenResponse) => {
          const accessToken = String(tokenResponse?.access_token || '').trim();
          if (!accessToken) {
            reject(new Error('Google OAuth did not return access token'));
            return;
          }
          resolve(accessToken);
        },
      });
      tokenClient.requestAccessToken();
    });
  };

  const resolveProviderAccessToken = async (provider: OAuthProvider): Promise<string> => {
    if (provider === OAuthProvider.GOOGLE) {
      return requestGoogleAccessToken();
    }
    if (provider === OAuthProvider.TWITTER) {
      const result = await startSocialOauth('TWITTER');
      return result.accessToken;
    }
    if (provider === OAuthProvider.TIKTOK) {
      const result = await startSocialOauth('TIKTOK');
      return result.accessToken;
    }
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  };

  const handleLinkProvider = async (provider: OAuthProvider) => {
    if (linkingProvider || unlinkingProvider) {
      return;
    }
    setLinkingProvider(provider);
    try {
      const accessToken = await resolveProviderAccessToken(provider);
      await dataSync.linkOauth(provider, accessToken);
      await refreshCurrentUser();
      setStatusBanner({
        kind: 'success',
        message: `${provider} account linked.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : `Failed to link ${provider} account.`,
      });
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleUnlinkProvider = async (provider: OAuthProvider) => {
    if (linkingProvider || unlinkingProvider) {
      return;
    }
    setUnlinkingProvider(provider);
    try {
      await dataSync.unlinkOauth(provider);
      await refreshCurrentUser();
      setStatusBanner({
        kind: 'success',
        message: `${provider} account unlinked.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : `Failed to unlink ${provider} account.`,
      });
    } finally {
      setUnlinkingProvider(null);
    }
  };

  const oauthRows: Array<{
    provider: OAuthProvider;
    label: string;
    subtitle: string;
    disabledReason: string;
    icon: React.ReactNode;
  }> = [
    {
      provider: OAuthProvider.GOOGLE,
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
      provider: OAuthProvider.TWITTER,
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
      provider: OAuthProvider.TIKTOK,
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

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: name.trim() || displayName,
        bio: bio.trim(),
      };
      const updated = await dataSync.updateUserProfile(payload);
      const updatedUser = (updated && typeof updated === 'object')
        ? (updated as Record<string, unknown>)
        : null;
      if (updatedUser) {
        setAuthSession(updatedUser, authToken, authRefreshToken || undefined);
        setName(String(updatedUser.displayName || updatedUser.handle || name || 'User'));
        setBio(typeof updatedUser.bio === 'string' ? updatedUser.bio : '');
      }
      setStatusBanner({
        kind: 'success',
        message: t('Profile.updateSuccess'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('Profile.updateError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('Profile.pageTitle')}
      description={t('Profile.pageDescription')}
      footer={<SaveFooter onSave={() => { void handleSave(); }} saving={saving} />}
    >
      {/* Profile Header Card */}
      <section>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-20 w-20 rounded-full bg-white/10 blur-xl" />
          <div className="relative flex items-center gap-5">
            <div className="relative">
              <EntityAvatar
                imageUrl={userAvatarUrl}
                name={displayName}
                kind="human"
                sizeClassName="h-24 w-24"
                className="ring-4 ring-white/20"
                textClassName="text-3xl font-bold"
                fallbackClassName="bg-white/20 text-white backdrop-blur-sm"
              />
              <button
                type="button"
                className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-mint-600 shadow-lg transition-transform hover:scale-110"
              >
                {ICON_CAMERA}
              </button>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold">{displayName}</h3>
              <p className="text-sm text-white/80">@{userHandle.replace(/^@/, '')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Basic Information */}
      <section className="mt-8">
        <SectionTitle>{t('Profile.sectionBasicInfo')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            {/* Display Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.displayName')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_USER}
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Profile.displayNamePlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                />
              </div>
            </div>

            {/* Username - Read Only */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.username')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_USER}
                </div>
                <input
                  type="text"
                  value={userHandle}
                  readOnly
                  className="w-full rounded-xl border border-gray-100 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{t('Profile.usernameHelper')}</p>
            </div>

            {/* Email - Read Only */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.email')}
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  {ICON_MAIL}
                </div>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full rounded-xl border border-gray-100 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{t('Profile.emailHelper')}</p>
            </div>

            {/* Bio */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('Profile.bio')}
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t('Profile.bioPlaceholder')}
                maxLength={BIO_MAX}
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
              />
              <div className="mt-1.5 flex justify-end">
                <span className="text-xs text-gray-400">
                  {bio.length}/{BIO_MAX} characters
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Connected Accounts */}
      <section className="mt-8">
        <SectionTitle description={t('Profile.connectedAccountsDescription')}>
          {t('Profile.sectionConnectedAccounts')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {/* Email */}
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
                <div className="h-px bg-gray-50 mx-5" />
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
                        void handleUnlinkProvider(row.provider);
                      } else {
                        void handleLinkProvider(row.provider);
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
    </PageShell>
  );
}

type SettingsDropdownOption = {
  value: string;
  label: string;
};

function SettingsDropdown({
  value,
  onChange,
  options,
  disabled,
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SettingsDropdownOption[];
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((item) => item.value === value)?.label || value;

  return (
    <div ref={dropdownRef} className="relative">
      {icon ? (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          {icon}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-10 text-sm text-gray-900 outline-none transition-all hover:border-mint-300 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60"
      >
        <span>{selectedLabel}</span>
      </button>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                value === option.value
                  ? 'bg-mint-50 text-mint-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                {value === option.value && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mint-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span className={value === option.value ? 'ml-0' : 'ml-6'}>{option.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LanguageRegionPage() {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [language, setLanguage] = useState<SupportedLocale>(getCurrentLocale());
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [saving, setSaving] = useState(false);
  const languageOptions: SettingsDropdownOption[] = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: getLocaleLabel(locale),
  }));
  const timezoneOptions: SettingsDropdownOption[] = [
    { value: 'Asia/Shanghai', label: t('LanguageRegion.timezoneCst') },
    { value: 'Asia/Tokyo', label: t('LanguageRegion.timezoneJst') },
    { value: 'America/New_York', label: t('LanguageRegion.timezoneEt') },
    { value: 'America/Los_Angeles', label: t('LanguageRegion.timezonePt') },
    { value: 'Europe/London', label: t('LanguageRegion.timezoneGmt') },
    { value: 'Europe/Berlin', label: t('LanguageRegion.timezoneCet') },
  ];
  const dateFormatOptions: SettingsDropdownOption[] = [
    { value: 'YYYY-MM-DD', label: t('LanguageRegion.dateFormatIso') },
    { value: 'MM/DD/YYYY', label: t('LanguageRegion.dateFormatUs') },
    { value: 'DD/MM/YYYY', label: t('LanguageRegion.dateFormatEu') },
    { value: 'DD.MM.YYYY', label: t('LanguageRegion.dateFormatDe') },
  ];

  const handleLanguageChange = async (locale: SupportedLocale) => {
    if (saving) {
      return;
    }
    setLanguage(locale);
    setSaving(true);
    try {
      await changeLocale(locale);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('LanguageRegion.changeLanguageError'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('LanguageRegion.pageTitle')}
      description={t('LanguageRegion.pageDescription')}
    >
      {/* Language Card */}
      <section>
        <SectionTitle>{t('LanguageRegion.sectionDisplayLanguage')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.language')}
              </label>
              <SettingsDropdown
                value={language}
                onChange={(locale) => { void handleLanguageChange(locale as SupportedLocale); }}
                options={languageOptions}
                disabled={saving}
                icon={<LanguageIcon className="h-5 w-5" />}
              />
              <p className="mt-1.5 text-xs text-gray-400">{t('LanguageRegion.languageHelper')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Region Settings Card */}
      <section className="mt-8">
        <SectionTitle>{t('LanguageRegion.sectionRegionSettings')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            {/* Timezone */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.timezone')}
              </label>
              <SettingsDropdown
                value={timezone}
                onChange={setTimezone}
                options={timezoneOptions}
                icon={<ClockIcon className="h-5 w-5" />}
              />
            </div>

            {/* Date Format */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('LanguageRegion.dateFormat')}
              </label>
              <SettingsDropdown
                value={dateFormat}
                onChange={setDateFormat}
                options={dateFormatOptions}
                icon={<CalendarIcon className="h-5 w-5" />}
              />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
