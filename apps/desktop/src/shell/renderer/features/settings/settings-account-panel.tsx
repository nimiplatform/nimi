import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useEffect, useRef, useState } from 'react';
import {
  loadNimiRealmCreatorEligibility,
  uploadNimiRealmResourceFile,
} from '@nimiplatform/sdk/realm';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FieldShell,
  NimiText,
  TextareaField,
  TextField,
} from '@nimiplatform/kit/ui';
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
  Card,
  FormFeedback,
  PageShell,
  Section,
  StatusBadge,
} from './settings-layout-components.js';
import { AwardIcon } from './settings-preferences-panel-parts.js';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

type ProfileSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>('idle');

  const eligibilityQuery = useQuery({
    queryKey: ['settings-creator-eligibility'],
    queryFn: async () => loadNimiRealmCreatorEligibility(bindings.sdk.realm()),
  });
  const eligibility = eligibilityQuery.data;
  const eligibilityState = eligibilityQuery.isPending
    ? 'loading'
    : eligibilityQuery.isError || !eligibility
      ? 'unavailable'
      : eligibility.isEligible
        ? 'eligible'
        : 'not-eligible';
  const eligibilityText = eligibilityQuery.isPending
    ? t('Profile.loadingEligibility')
    : eligibilityQuery.isError
      ? t('Profile.eligibilityLoadError')
      : eligibility
        ? `${eligibility.tier} · ${eligibility.status}`
        : t('Profile.eligibilityLoadError');
  const eligibilityBadgeText = eligibilityState === 'loading'
    ? t('Profile.eligibilityLoadingStatus')
    : eligibilityState === 'unavailable'
      ? t('Profile.eligibilityUnavailable')
      : eligibilityState === 'eligible'
        ? t('Profile.eligible')
        : t('Profile.notEligible');
  const eligibilityBadgeStatus = eligibilityState === 'eligible'
    ? 'success'
    : eligibilityState === 'not-eligible'
      ? 'warning'
      : 'info';
  const isEligible = eligibilityState === 'eligible';
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAutosaveTimerRef = useRef<(() => void) | null>(null);
  // Edit-version race guard: bumped on every user edit. Server-driven form
  // resets (save response and store sync) only apply when no newer local edit
  // happened since the snapshot — newer local edits always win.
  const editVersionRef = useRef(0);
  const appliedEditVersionRef = useRef(0);
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

  const markLocalEdit = () => {
    editVersionRef.current += 1;
    setSaveStatus((current) => (current === 'saved' ? 'idle' : current));
  };

  const handleNameChange = (value: string) => {
    markLocalEdit();
    setName(value);
  };

  const handleBioChange = (value: string) => {
    markLocalEdit();
    setBio(value);
  };

  useEffect(() => {
    if (editVersionRef.current !== appliedEditVersionRef.current) {
      return;
    }
    setName(displayName);
    setAvatarUrl(userAvatarUrl);
    setBio(String(user?.bio || ''));
  }, [displayName, user?.bio, userAvatarUrl]);

  useEffect(() => () => {
    profileAutosaveTimerRef.current?.();
  }, []);

  const hasPendingProfileChanges = (
    profileDraft.displayName !== persistedProfile.displayName
    || profileDraft.avatarUrl !== persistedProfile.avatarUrl
    || profileDraft.bio !== persistedProfile.bio
  );

  const handleSave = async ({ silentSuccess = false }: { silentSuccess?: boolean } = {}) => {
    if (saving || uploadingAvatar) {
      return;
    }
    const editSnapshot = editVersionRef.current;
    setSaving(true);
    setSaveStatus('saving');
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
        if (editVersionRef.current === editSnapshot) {
          appliedEditVersionRef.current = editSnapshot;
          setName(String(updatedUser.displayName || updatedUser.handle || name || 'User'));
          setAvatarUrl(typeof updatedUser.avatarUrl === 'string' ? updatedUser.avatarUrl : null);
          setBio(typeof updatedUser.bio === 'string' ? updatedUser.bio : '');
        }
      }
      setSaveStatus('saved');
      setFeedback((current) => (current?.kind === 'error' ? null : current));
      if (!silentSuccess) {
        setFeedback({
          kind: 'success',
          message: t('Profile.updateSuccess'),
        });
      }
    } catch (error) {
      setSaveStatus('error');
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
      markLocalEdit();
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

  const saveStatusBadge = saveStatus === 'saving' ? (
    <StatusBadge status="info" text={t('Settings.statusSaving')} />
  ) : saveStatus === 'saved' ? (
    <StatusBadge status="success" text={t('Settings.statusSaved')} />
  ) : saveStatus === 'error' ? (
    <StatusBadge status="error" text={t('Settings.statusFailed')} />
  ) : null;

  return (
    <PageShell
      title={t('Profile.pageTitle')}
      description={t('Profile.pageDescription')}
      status={saveStatusBadge}
    >
      {feedback ? (
        <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
      ) : null}

      <Card>
        <div data-testid="settings-profile-summary" className="flex items-center gap-4">
          <div className="relative shrink-0">
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
              sizeClassName="h-16 w-16"
              className="ring-2 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)]"
              textClassName="text-[length:var(--nimi-type-section-title-size)] font-bold"
              fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] text-[var(--nimi-action-primary-bg)]"
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-fg)] shadow-lg transition-transform hover:scale-110 hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              title={uploadingAvatar ? t('Profile.avatarUploading') : t('Profile.changePhoto')}
            >
              {ICON_CAMERA}
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <NimiText as="h3" role="section-title" className="truncate">
              {name.trim() || displayName}
            </NimiText>
            <NimiText role="caption" className="mt-0.5 block">
              @{userHandle.replace(/^@/, '')}
            </NimiText>
            {uploadingAvatar ? (
              <NimiText role="helper" className="mt-1">
                {t('Profile.avatarUploading')}
              </NimiText>
            ) : null}
          </div>
        </div>
      </Card>

      <Section title={t('Profile.sectionBasicInfo')}>
        <Card>
          <div className="flex flex-col gap-4">
            <FieldShell label={t('Profile.displayName')}>
              <TextField
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder={t('Profile.displayNamePlaceholder')}
                leading={ICON_USER}
              />
            </FieldShell>
            <FieldShell label={t('Profile.username')} description={t('Profile.usernameHelper')}>
              <TextField
                value={userHandle}
                readOnly
                leading={ICON_USER}
              />
            </FieldShell>
            <FieldShell label={t('Profile.email')} description={t('Profile.emailHelper')}>
              <TextField
                type="email"
                value={email}
                readOnly
                leading={ICON_MAIL}
              />
            </FieldShell>
            <FieldShell
              label={t('Profile.bio')}
              message={t('Profile.bioCharacterCount', { count: bio.length, max: BIO_MAX })}
            >
              <TextareaField
                value={bio}
                onChange={(event) => handleBioChange(event.target.value)}
                placeholder={t('Profile.bioPlaceholder')}
                maxLength={BIO_MAX}
                rows={3}
                textareaClassName="resize-none"
              />
            </FieldShell>
          </div>
        </Card>
      </Section>

      <Section title={t('Profile.sectionCreatorEligibility')}>
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-[var(--nimi-radius-md)] ${isEligible ? 'bg-mint-100 text-mint-600' : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)]'}`}>
                <AwardIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[length:var(--nimi-type-label-size)] font-medium text-[var(--nimi-text-primary)]">{t('Profile.eligibility')}</p>
                <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{eligibilityText}</p>
              </div>
            </div>
            <StatusBadge status={eligibilityBadgeStatus} text={eligibilityBadgeText} />
          </div>
          {eligibility?.message ? (
            <p className="mt-4 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{eligibility.message}</p>
          ) : null}
        </Card>
      </Section>

    </PageShell>
  );
}
