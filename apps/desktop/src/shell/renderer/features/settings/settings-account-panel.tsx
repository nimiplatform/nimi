import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useEffect, useRef, useState } from 'react';
import {
  linkRealmOAuth,
  OAuthProvider,
  unlinkRealmOAuth,
  uploadRealmResourceFileWithRealm,
} from '@nimiplatform/sdk/realm';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { ShellAuthWindow } from '@nimiplatform/kit/auth';
import { getGoogleClientId, loadGoogleScript } from '@nimiplatform/kit/auth';
import { startSocialOauth } from '@nimiplatform/kit/auth';
import { desktopOAuthBridge } from '@renderer/features/auth/desktop-auth-adapter.js';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  BIO_MAX,
  ICON_CAMERA,
  ICON_MAIL,
  ICON_USER,
} from './settings-assets.js';
import {
  FormFeedback,
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { ProfileConnectedAccountsSection } from './settings-account-oauth-section.js';

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.auth.user);
  const realmBaseUrl = useAppStore((s) => String(s.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const setAuthSession = useAppStore((s) => s.setAuthSession);
  const displayName = String(user?.displayName || user?.handle || 'User');
  const userHandle = String(user?.handle || 'me');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;

  const [name, setName] = useState(displayName);
  const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl);
  const email = String(user?.email || '');
  const [bio, setBio] = useState(String(user?.bio || ''));
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedProviders = Array.isArray(user?.oauthProviders)
    ? user.oauthProviders.filter((item): item is OAuthProvider => (
      item === OAuthProvider.GOOGLE || item === OAuthProvider.TWITTER || item === OAuthProvider.TIKTOK
    ))
    : [];
  const connectedProviderSet = new Set<OAuthProvider>(connectedProviders);
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
    const latest = await realmSocialData.loadCurrentUser();
    const updatedUser = parseOptionalJsonObject(latest) ?? null;
    setAuthSession(updatedUser);
  };

  useEffect(() => {
    setName(displayName);
    setAvatarUrl(userAvatarUrl);
    setBio(String(user?.bio || ''));
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
    const win = window as ShellAuthWindow;
    const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
    if (!initTokenClient) {
      throw new Error(t('Profile.googleOauthInitFailed'));
    }
    return new Promise((resolve, reject) => {
      const tokenClient = initTokenClient({
        client_id: clientId,
        scope: 'email profile openid',
        callback: (tokenResponse: { access_token?: string }) => {
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
      const result = await startSocialOauth('TWITTER', desktopOAuthBridge);
      return result.accessToken;
    }
    if (provider === OAuthProvider.TIKTOK) {
      const result = await startSocialOauth('TIKTOK', desktopOAuthBridge);
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
      await linkRealmOAuth(getPlatformClient().realm, provider, accessToken);
      await refreshCurrentUser();
      setFeedback(null);
    } catch (error) {
      setFeedback({
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
      await unlinkRealmOAuth(getPlatformClient().realm, provider);
      await refreshCurrentUser();
      setFeedback(null);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : `Failed to unlink ${provider} account.`,
      });
    } finally {
      setUnlinkingProvider(null);
    }
  };

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
      const payload = {
        displayName: profileDraft.displayName,
        avatarUrl: profileDraft.avatarUrl,
        bio: profileDraft.bio,
      };
      const updated = await realmSocialData.updateUserProfile(payload);
      const updatedUser = parseOptionalJsonObject(updated) ?? null;
      if (updatedUser) {
        if (typeof updatedUser.avatarUrl !== 'string') {
          updatedUser.avatarUrl = avatarUrl;
        }
        setAuthSession(updatedUser);
        setName(String(updatedUser.displayName || updatedUser.handle || name || 'User'));
        setAvatarUrl(typeof updatedUser.avatarUrl === 'string' ? updatedUser.avatarUrl : null);
        setBio(typeof updatedUser.bio === 'string' ? updatedUser.bio : '');
      }
      if (!silentSuccess) {
        setFeedback({
          kind: 'success',
          message: t('Profile.updateSuccess'),
        });
      }
    } catch (error) {
      setFeedback({
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
      setFeedback({
        kind: 'error',
        message: t('Profile.avatarUnsupportedFormat'),
      });
      return;
    }
    if (file.size > MAX_AVATAR_FILE_SIZE) {
      setFeedback({
        kind: 'error',
        message: t('Profile.avatarSizeLimit'),
      });
      return;
    }
    if (!realmBaseUrl) {
      setFeedback({
        kind: 'error',
        message: t('Profile.avatarUploadUnavailable'),
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      const uploaded = await uploadRealmResourceFileWithRealm({
        realm: getPlatformClient().realm,
        kind: 'image',
        file,
        failureMessage: t('Profile.avatarUploadFailed'),
      });
      const nextAvatarUrl = uploaded.resource.url;
      if (!nextAvatarUrl) {
        throw new Error(t('Profile.avatarUploadFailed'));
      }
      setAvatarUrl(nextAvatarUrl);
      setFeedback({
        kind: 'success',
        message: t('Profile.avatarUploadSuccess'),
      });
    } catch (error) {
      setFeedback({
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
      {feedback ? (
        <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-6" />
      ) : null}
      <section className="sticky top-0 z-10 -mx-6 bg-white px-6 pb-4 pt-2">
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
                fallbackClassName="bg-white/20 text-white"
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
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
                  className="w-full rounded-xl border border-gray-200 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
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
                  className="w-full rounded-xl border border-gray-200 bg-gray-100 py-3 pl-11 pr-4 text-sm text-gray-500 cursor-not-allowed"
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

      <ProfileConnectedAccountsSection
        connectedProviderSet={connectedProviderSet}
        email={email}
        googleClientId={googleClientId}
        linkingProvider={linkingProvider}
        onLinkProvider={(provider) => void handleLinkProvider(provider)}
        onUnlinkProvider={(provider) => void handleUnlinkProvider(provider)}
        unlinkingProvider={unlinkingProvider}
      />
    </PageShell>
  );
}
