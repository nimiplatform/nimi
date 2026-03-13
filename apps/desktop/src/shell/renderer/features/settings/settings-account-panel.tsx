import { useEffect, useRef, useState } from 'react';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
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
  SectionTitle,
} from './settings-layout-components';

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.auth.user);
  const authToken = useAppStore((s) => s.auth.token);
  const authRefreshToken = useAppStore((s) => s.auth.refreshToken);
  const realmBaseUrl = useAppStore((s) => String(s.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const setAuthSession = useAppStore((s) => s.setAuthSession);
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const displayName = String(user?.displayName || user?.handle || 'User');
  const userHandle = String(user?.handle || 'me');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;

  const [name, setName] = useState(displayName);
  const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl);
  const email = String(user?.email || '');
  const [bio, setBio] = useState(String(user?.bio || t('Profile.bioPlaceholder')));
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedProviders = Array.isArray(user?.oauthProviders)
    ? user.oauthProviders.filter((item): item is OAuthProvider => (
      item === OAuthProvider.GOOGLE || item === OAuthProvider.TWITTER || item === OAuthProvider.TIKTOK
    ))
    : [];
  const connectedProviderSet = new Set<OAuthProvider>(connectedProviders);
  const twitterOauthConfig = resolveSocialOauthConfig('TWITTER');
  const tikTokOauthConfig = resolveSocialOauthConfig('TIKTOK');
  const googleClientId = getGoogleClientId();
  const profileDraft = {
    displayName: name.trim() || displayName,
    avatarUrl,
    bio: bio.trim(),
  };
  const persistedProfile = {
    displayName,
    avatarUrl: userAvatarUrl,
    bio: String(user?.bio || ''),
  };

  const refreshCurrentUser = async () => {
    const latest = await dataSync.loadCurrentUser();
    const updatedUser = latest && typeof latest === 'object'
      ? (latest as Record<string, unknown>)
      : null;
    setAuthSession(updatedUser, authToken, authRefreshToken || undefined);
  };

  useEffect(() => {
    setName(displayName);
    setAvatarUrl(userAvatarUrl);
    setBio(String(user?.bio || t('Profile.bioPlaceholder')));
  }, [displayName, t, user?.bio, userAvatarUrl]);

  useEffect(() => () => {
    if (profileAutosaveTimerRef.current) {
      clearTimeout(profileAutosaveTimerRef.current);
    }
  }, []);

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

  const hasPendingProfileChanges = (
    profileDraft.displayName !== persistedProfile.displayName
    || profileDraft.avatarUrl !== persistedProfile.avatarUrl
    || profileDraft.bio !== persistedProfile.bio
  );

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || uploadingAvatar) {
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: profileDraft.displayName,
        avatarUrl: profileDraft.avatarUrl,
        bio: profileDraft.bio,
      };
      const updated = await dataSync.updateUserProfile(payload);
      const updatedUser = (updated && typeof updated === 'object')
        ? (updated as Record<string, unknown>)
        : null;
      if (updatedUser) {
        if (typeof updatedUser.avatarUrl !== 'string') {
          updatedUser.avatarUrl = avatarUrl;
        }
        setAuthSession(updatedUser, authToken, authRefreshToken || undefined);
        setName(String(updatedUser.displayName || updatedUser.handle || name || 'User'));
        setAvatarUrl(typeof updatedUser.avatarUrl === 'string' ? updatedUser.avatarUrl : null);
        setBio(typeof updatedUser.bio === 'string' ? updatedUser.bio : '');
      }
      if (!silentSuccess) {
        setStatusBanner({
          kind: 'success',
          message: t('Profile.updateSuccess'),
        });
      }
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('Profile.updateError'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setStatusBanner({
        kind: 'error',
        message: t('Profile.avatarUnsupportedFormat'),
      });
      return;
    }
    if (file.size > MAX_AVATAR_FILE_SIZE) {
      setStatusBanner({
        kind: 'error',
        message: t('Profile.avatarSizeLimit'),
      });
      return;
    }
    if (!realmBaseUrl) {
      setStatusBanner({
        kind: 'error',
        message: t('Profile.avatarUploadUnavailable'),
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      const upload = await dataSync.createImageDirectUpload();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(upload.uploadUrl, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(t('Profile.avatarUploadFailed'));
      }
      const nextAvatarUrl = `${realmBaseUrl}/api/media/images/${encodeURIComponent(upload.storageRef)}`;
      setAvatarUrl(nextAvatarUrl);
      setStatusBanner({
        kind: 'success',
        message: t('Profile.avatarUploadSuccess'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('Profile.avatarUploadFailed'),
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  useEffect(() => {
    if (uploadingAvatar || saving || !hasPendingProfileChanges) {
      if (profileAutosaveTimerRef.current) {
        clearTimeout(profileAutosaveTimerRef.current);
        profileAutosaveTimerRef.current = null;
      }
      return;
    }

    if (profileAutosaveTimerRef.current) {
      clearTimeout(profileAutosaveTimerRef.current);
    }

    profileAutosaveTimerRef.current = setTimeout(() => {
      void handleSave({ silentSuccess: true });
    }, 700);

    return () => {
      if (profileAutosaveTimerRef.current) {
        clearTimeout(profileAutosaveTimerRef.current);
        profileAutosaveTimerRef.current = null;
      }
    };
  }, [
    avatarUrl,
    bio,
    displayName,
    hasPendingProfileChanges,
    name,
    saving,
    uploadingAvatar,
    userAvatarUrl,
  ]);

  return (
    <PageShell
      title={t('Profile.pageTitle')}
      description={t('Profile.pageDescription')}
    >
      <section className="sticky top-0 z-10 -mx-6 bg-[#F8F9FB] px-6 pb-4 pt-2">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-20 w-20 rounded-full bg-white/10 blur-xl" />
          <div className="relative flex items-start gap-5">
            <div className="relative">
              <input
                ref={avatarInputRef}
                type="file"
                accept={ACCEPTED_AVATAR_TYPES.join(',')}
                className="hidden"
                onChange={(event) => {
                  void handleAvatarUpload(event);
                }}
              />
              <EntityAvatar
                imageUrl={avatarUrl}
                name={name.trim() || displayName}
                kind="human"
                sizeClassName="h-24 w-24"
                className="ring-4 ring-white/20"
                textClassName="text-3xl font-bold"
                fallbackClassName="bg-white/20 text-white backdrop-blur-sm"
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-mint-600 shadow-lg transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60"
                title={uploadingAvatar ? t('Profile.avatarUploading') : t('Profile.changePhoto')}
              >
                {ICON_CAMERA}
              </button>
            </div>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-bold">{name.trim() || displayName}</h3>
                <p className="text-sm text-white/80">@{userHandle.replace(/^@/, '')}</p>
                {uploadingAvatar ? <p className="mt-2 text-xs text-white/75">{t('Profile.avatarUploading')}</p> : null}
              </div>
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
