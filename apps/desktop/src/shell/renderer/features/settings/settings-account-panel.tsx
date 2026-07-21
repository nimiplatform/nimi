import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useEffect, useRef, useState } from 'react';
import {
  NIMI_REALM_OAUTH_PROVIDER,
  uploadNimiRealmResourceFile,
  type NimiRealmOAuthProvider,
} from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { useAppStore } from '../../app-shell/providers/app-store';
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
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { ProfileConnectedAccountsSection } from './settings-account-oauth-section.js';
import { profileOauthPlatform } from './profile-oauth-platform.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

export function ProfilePage() {
  const bindings = useDesktopRendererBindings();
  const realmSocialData = useRealmSocialData();
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
  const [linkingProvider, setLinkingProvider] = useState<NimiRealmOAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<NimiRealmOAuthProvider | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAutosaveTimerRef = useRef<(() => void) | null>(null);
  const connectedProviders = Array.isArray(user?.oauthProviders)
    ? user.oauthProviders.filter((item): item is NimiRealmOAuthProvider => (
      item === NIMI_REALM_OAUTH_PROVIDER.GOOGLE
      || item === NIMI_REALM_OAUTH_PROVIDER.TWITTER
      || item === NIMI_REALM_OAUTH_PROVIDER.TIKTOK
    ))
    : [];
  const connectedProviderSet = new Set<NimiRealmOAuthProvider>(connectedProviders);
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
    profileAutosaveTimerRef.current?.();
  }, []);

  const handleLinkProvider = async (provider: NimiRealmOAuthProvider) => {
    if (linkingProvider || unlinkingProvider) {
      return;
    }
    setLinkingProvider(provider);
    try {
      await profileOauthPlatform.linkProvider(provider);
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

  const handleUnlinkProvider = async (provider: NimiRealmOAuthProvider) => {
    if (linkingProvider || unlinkingProvider) {
      return;
    }
    setUnlinkingProvider(provider);
    try {
      await profileOauthPlatform.unlinkProvider(provider);
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
      const uploaded = await uploadNimiRealmResourceFile(bindings.sdk.realm(), {
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
      profileAutosaveTimerRef.current?.();
      profileAutosaveTimerRef.current = null;
      return;
    }

    profileAutosaveTimerRef.current?.();
    profileAutosaveTimerRef.current = bindings.clock.schedule(700, (result) => {
      if (result.ok) void handleSave({ silentSuccess: true });
    });

    return () => {
      profileAutosaveTimerRef.current?.();
      profileAutosaveTimerRef.current = null;
    };
  }, [
    avatarUrl,
    bindings,
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
      <section
        data-testid="settings-profile-summary"
        className="sticky top-0 z-10 -mx-5 nimi-material-glass-regular bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_82%,transparent)] px-5 pb-4 pt-1 backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      >
        <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_94%,white)] p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
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
                className="ring-4 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)]"
                textClassName="text-2xl font-bold"
                fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] text-[var(--nimi-action-primary-bg)]"
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-fg)] shadow-lg transition-transform hover:scale-110 hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                title={uploadingAvatar ? t('Profile.avatarUploading') : t('Profile.changePhoto')}
              >
                {ICON_CAMERA}
              </button>
            </div>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-[var(--nimi-text-primary)]">{name.trim() || displayName}</h3>
                <p className="text-sm text-[var(--nimi-text-secondary)]">@{userHandle.replace(/^@/, '')}</p>
                {uploadingAvatar ? <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t('Profile.avatarUploading')}</p> : null}
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
        linkingProvider={linkingProvider}
        onLinkProvider={(provider) => void handleLinkProvider(provider)}
        onUnlinkProvider={(provider) => void handleUnlinkProvider(provider)}
        unlinkingProvider={unlinkingProvider}
      />
    </PageShell>
  );
}
