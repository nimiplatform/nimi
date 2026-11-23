import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Button,
  FieldShell,
  OverlayShell,
  SelectField,
  TextareaField,
  TextField,
  cn,
} from '@nimiplatform/kit/ui';
import { Camera, Check, Copy, ExternalLink, Eye, Globe, MapPin, Pencil, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { Card, FormFeedback, PageShell, Section, StatusBadge } from '../settings/settings-layout-components.js';
import { formatCountryName, ProfileCountryField } from '../relationship/profile-country-field.js';
import {
  formatProfileLanguages,
  ProfileLanguageInput,
  ProfileTagInput,
} from './profile-chip-fields.js';
import type { HumanProfileData } from './profile-model.js';
import {
  buildEditableProfileDraft,
  previewProfileDraft,
  profileChangedFields,
  profileDraftFieldErrors,
  profileDraftPatch,
  PROFILE_GENDERS,
  PROFILE_LIMITS,
  type EditableProfileDraft,
  type ProfileDraftFieldKey,
} from './profile-edit-model.js';

export type ProfileVisibilitySummary = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';

export type ProfileEditorProps = {
  profile: HumanProfileData;
  profileVisibility?: ProfileVisibilitySummary | null;
  onSave: (patch: JsonObject) => Promise<HumanProfileData | null>;
  onUploadAvatar: (file: File) => Promise<Pick<EditableProfileDraft, 'avatarUrl' | 'avatarResourceId' | 'avatarMedia'> | null>;
  onCopyHandle?: (handle: string) => Promise<void>;
  onManageUsernameInWeb?: () => Promise<void>;
  onOpenPrivacy?: () => void;
  onOpenFullProfile?: () => void;
};

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function formatHandle(handle: string): string {
  const clean = handle.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : '';
}

function formatVisibilityLabel(
  visibility: ProfileVisibilitySummary,
  t: (key: string) => string,
): string {
  if (visibility === 'PUBLIC') return t('PrivacySettings.visibilityPublic');
  if (visibility === 'FRIENDS') return t('PrivacySettings.visibilityFriends');
  return t('PrivacySettings.visibilityPrivate');
}

function ProfilePreviewCard({
  previewProfile,
  formattedHandle,
  locale,
  visibility,
  dirty,
  copiedHandle,
  testId,
  onOpenFullProfile,
  onCopyHandle,
}: {
  previewProfile: HumanProfileData;
  formattedHandle: string;
  locale: string;
  visibility?: ProfileVisibilitySummary | null;
  dirty: boolean;
  copiedHandle?: boolean;
  testId: string;
  onOpenFullProfile?: () => void;
  onCopyHandle?: () => void;
}) {
  const { t } = useTranslation();
  const localizedCountry = formatCountryName(previewProfile.countryCode, locale);
  const location = [previewProfile.city, localizedCountry].filter(Boolean).join(', ');
  const formattedLanguages = formatProfileLanguages(previewProfile.languages, locale);

  return (
    <Card className="overflow-hidden p-0">
      <div data-testid={testId}>
        <div className="flex h-12 items-start justify-end border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-panel))] px-3 py-2">
          {visibility ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-0.5 text-xs text-[var(--nimi-text-secondary)]">
              {formatVisibilityLabel(visibility, t)}
            </span>
          ) : null}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-7 mb-2.5 flex items-end justify-between gap-2">
            <EntityAvatar
              imageUrl={previewProfile.avatarUrl}
              media={previewProfile.avatarMedia}
              name={previewProfile.displayName}
              kind="human"
              sizeClassName="h-14 w-14 shrink-0"
              className="border-2 border-[var(--nimi-surface-card)] ring-1 ring-[var(--nimi-border-subtle)]"
              fallbackClassName="bg-[var(--nimi-surface-panel)] text-lg font-semibold text-[var(--nimi-text-secondary)]"
            />
            {dirty ? (
              <StatusBadge status="info" text={t('Profile.previewDraftTag')} />
            ) : null}
          </div>
          <h3 className="break-words text-base font-semibold text-[var(--nimi-text-primary)]">
            {previewProfile.displayName}
          </h3>
          {formattedHandle ? (
            <p className="mt-0.5 font-mono text-xs text-[var(--nimi-text-secondary)]">{formattedHandle}</p>
          ) : null}
          <p
            className={cn(
              'mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed',
              previewProfile.bio ? 'text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)]',
            )}
          >
            {previewProfile.bio || t('Profile.noDescription')}
          </p>
          {location ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              <MapPin size={13} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
              <span className="break-words">{location}</span>
            </p>
          ) : null}
          {formattedLanguages ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              <Globe size={13} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
              <span className="break-words">{formattedLanguages}</span>
            </p>
          ) : null}
          {previewProfile.tags.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('Relationship.tags')}>
              {previewProfile.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-[var(--nimi-surface-active)] px-2.5 py-0.5 text-xs text-[var(--nimi-text-secondary)]"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
          {onOpenFullProfile || (onCopyHandle && formattedHandle) ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
              {onOpenFullProfile ? (
                <button
                  type="button"
                  onClick={onOpenFullProfile}
                  className="text-xs font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
                >
                  {t('Profile.viewFullProfile')}
                </button>
              ) : <span />}
              {onCopyHandle && formattedHandle ? (
                <button
                  type="button"
                  onClick={onCopyHandle}
                  className="text-xs text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]"
                >
                  {copiedHandle ? t('Profile.usernameCopied') : t('Profile.copyUsername')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
// @nimi-authority: rule.nimi.desktop.product-surfaces.public-profile-editor
export function PublicProfileEditor({
  profile,
  profileVisibility = null,
  onSave,
  onUploadAvatar,
  onCopyHandle,
  onManageUsernameInWeb,
  onOpenPrivacy,
  onOpenFullProfile,
}: ProfileEditorProps) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const locale = i18n.getCurrentLocale();
  const navigation = useHomeNavigation();

  const [baseline, setBaseline] = useState(() => buildEditableProfileDraft(profile));
  const [draft, setDraft] = useState(baseline);
  const [touchedName, setTouchedName] = useState(false);
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openingWeb, setOpeningWeb] = useState(false);
  const [draggingAvatar, setDraggingAvatar] = useState(false);
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);
  const finishLeave = useRef<((allow: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const latestOwnerProfile = useRef(profile);

  const changedFields = useMemo(() => profileChangedFields(baseline, draft), [baseline, draft]);
  const dirty = changedFields.length > 0;
  const avatarDirty = changedFields.includes('avatar');
  const fieldErrors = useMemo(() => profileDraftFieldErrors(draft), [draft]);
  const formattedHandle = formatHandle(profile.handle);

  const current = useRef({ dirty, saving, uploading });
  current.current = { dirty, saving, uploading };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      finishLeave.current?.(false);
    };
  }, []);

  useEffect(() => {
    latestOwnerProfile.current = profile;
    if (!current.current.dirty && !current.current.saving && !current.current.uploading) {
      const next = buildEditableProfileDraft(profile);
      setBaseline(next);
      setDraft(next);
    }
  }, [profile]);

  useEffect(() => navigation.registerLeaveGuard(({ from, signal }) => {
    if (from.id !== 'settings' || (!current.current.dirty && !current.current.uploading)) return 'allow';
    if (current.current.saving || current.current.uploading) return 'busy';
    return new Promise<'allow' | 'cancel'>((resolve) => {
      const finish = (allow: boolean) => {
        signal.removeEventListener('abort', abort);
        finishLeave.current = null;
        if (mounted.current) setLeaveOpen(false);
        resolve(allow && !signal.aborted ? 'allow' : 'cancel');
      };
      const abort = () => finish(false);
      finishLeave.current = finish;
      signal.addEventListener('abort', abort, { once: true });
      setLeaveOpen(true);
    });
  }), [navigation]);

  const edit = (patch: Partial<EditableProfileDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setFeedback(null);
  };

  const focusFirstInvalidField = (errors: ReturnType<typeof profileDraftFieldErrors>) => {
    const target = errors.displayName
      ? displayNameRef.current
      : errors.bio
        ? bioRef.current
        : errors.city
          ? cityRef.current
          : null;
    if (target) {
      target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      target.focus();
    }
  };

  const save = async (): Promise<boolean> => {
    if (saving || uploading) return false;
    setSubmittedOnce(true);
    const errors = profileDraftFieldErrors(draft);
    if (Object.keys(errors).length > 0) {
      const firstKey = errors.displayName === 'name'
        ? 'name'
        : (errors.displayName || errors.bio || errors.city)
          ? 'length'
          : errors.languages
            ? 'languages'
            : 'tags';
      setFeedback({ kind: 'error', message: t(`Profile.editorValidation.${firstKey}`) });
      focusFirstInvalidField(errors);
      return false;
    }
    const patch = profileDraftPatch(baseline, draft);
    if (!Object.keys(patch).length) return true;
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await onSave(patch);
      if (!mounted.current || !updated) return false;
      latestOwnerProfile.current = updated;
      const next = buildEditableProfileDraft(updated);
      setBaseline(next);
      setDraft(next);
      setTouchedName(false);
      setSubmittedOnce(false);
      setPreview(false);
      setFeedback({ kind: 'success', message: t('Profile.updateSuccess') });
      return true;
    } catch (error) {
      if (mounted.current) {
        setFeedback({ kind: 'error', message: error instanceof Error ? error.message : t('Profile.updateError') });
      }
      return false;
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const discard = () => {
    const next = buildEditableProfileDraft(latestOwnerProfile.current);
    setBaseline(next);
    setDraft(next);
    setTouchedName(false);
    setSubmittedOnce(false);
    setPreview(false);
    setFeedback(null);
  };

  const processAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setFeedback({ kind: 'error', message: t('Profile.avatarUnsupportedFormat') });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFeedback({ kind: 'error', message: t('Profile.avatarSizeLimit') });
      return;
    }
    setUploading(true);
    setFeedback(null);
    try {
      const avatar = await onUploadAvatar(file);
      if (mounted.current && avatar) {
        edit(avatar);
        setFeedback({ kind: 'success', message: t('Profile.avatarUploadSuccess') });
      }
    } catch (error) {
      if (mounted.current) {
        setFeedback({ kind: 'error', message: error instanceof Error ? error.message : t('Profile.avatarUploadFailed') });
      }
    } finally {
      if (mounted.current) setUploading(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await processAvatarFile(file);
  };

  const handleAvatarDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDraggingAvatar(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    void processAvatarFile(file);
  };

  const handleCopyUsername = async () => {
    if (!formattedHandle || !onCopyHandle) return;
    try {
      await onCopyHandle(formattedHandle);
      if (!mounted.current) return;
      setCopiedHandle(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        if (mounted.current) setCopiedHandle(false);
      }, 2000);
    } catch {
      if (mounted.current) {
        setFeedback({ kind: 'error', message: t('Profile.usernameCopyFailed') });
      }
    }
  };

  const handleOpenWebUsername = async () => {
    if (!onManageUsernameInWeb || openingWeb) return;
    setOpeningWeb(true);
    setFeedback(null);
    try {
      await onManageUsernameInWeb();
    } catch (error) {
      if (mounted.current) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : t('Profile.manageUsernameUnavailable'),
        });
      }
    } finally {
      if (mounted.current) setOpeningWeb(false);
    }
  };

  const fieldLabelForSummary = (field: ProfileDraftFieldKey): string => {
    switch (field) {
      case 'avatar': return t('Profile.sectionProfilePicture');
      case 'displayName': return t('Profile.displayName');
      case 'bio': return t('Profile.bio');
      case 'countryCode': return t('Relationship.country');
      case 'city': return t('Relationship.city');
      case 'gender': return t('Profile.gender');
      case 'languages': return t('Profile.languages');
      case 'tags': return t('Relationship.tags');
    }
  };

  const dirtySummaryText = useMemo(() => {
    if (saving) return t('Settings.statusSaving');
    const labels = changedFields.map(fieldLabelForSummary);
    let list: string;
    try {
      list = new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(labels);
    } catch {
      list = labels.join(', ');
    }
    return t('Profile.unsavedChangesSummary', { count: changedFields.length, fields: list });
  }, [changedFields, locale, saving, t]);

  const previewProfile = previewProfileDraft(profile, draft);
  const busy = saving || uploading;
  const showNameError = (touchedName || submittedOnce) && fieldErrors.displayName;
  const nameErrorText = showNameError
    ? t(fieldErrors.displayName === 'name' ? 'Profile.editorValidation.name' : 'Profile.editorValidation.length')
    : undefined;
  const bioErrorText = submittedOnce && fieldErrors.bio ? t('Profile.editorValidation.length') : undefined;
  const cityErrorText = submittedOnce && fieldErrors.city ? t('Profile.editorValidation.length') : undefined;
  const languagesErrorText = submittedOnce && fieldErrors.languages ? t('Profile.editorValidation.languages') : undefined;
  const tagsErrorText = submittedOnce && fieldErrors.tags ? t('Profile.editorValidation.tags') : undefined;
  const bioNearLimit = draft.bio.length >= Math.floor(PROFILE_LIMITS.bio * 0.9);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {profileVisibility && onOpenPrivacy ? (
        <button
          type="button"
          onClick={onOpenPrivacy}
          data-testid="profile-visibility-pill"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-field-focus)] hover:text-[var(--nimi-text-primary)]"
        >
          <Shield size={13} className="shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true" />
          <span>
            {t('Profile.visibilityContext', {
              visibility: formatVisibilityLabel(profileVisibility, t),
            })}
          </span>
          <span className="font-medium text-[var(--nimi-action-primary-bg)]">{t('Profile.adjustPrivacy')}</span>
        </button>
      ) : null}
      <div className={preview ? '' : 'xl:hidden'}>
        <Button
          tone="secondary"
          size="sm"
          disabled={busy}
          leadingIcon={preview ? <Pencil size={15} /> : <Eye size={15} />}
          onClick={() => setPreview((value) => !value)}
        >
          {preview ? t('Profile.continueEditing') : t('Profile.previewProfile')}
        </Button>
      </div>
    </div>
  );

  const footer = (
    <>
      {dirty || saving ? (
        <div
          data-testid="profile-dirty-bar"
          className="border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-3"
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm font-medium text-[var(--nimi-text-primary)]">
              {dirtySummaryText}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button tone="secondary" disabled={busy || !dirty} onClick={discard}>
                {t('Profile.discardChanges')}
              </Button>
              <Button tone="primary" loading={saving} disabled={busy || !dirty} onClick={() => { void save(); }}>
                {t('Profile.saveProfile')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <OverlayShell
        open={leaveOpen}
        kind="dialog"
        onClose={() => finishLeave.current?.(false)}
        title={t('Profile.leaveTitle')}
      >
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Profile.leaveDescription')}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            tone="primary"
            loading={saving}
            disabled={busy}
            onClick={() => { void save().then((ok) => { if (ok) finishLeave.current?.(true); }); }}
          >
            {t('Profile.saveAndLeave')}
          </Button>
          <Button tone="danger" disabled={busy} onClick={() => finishLeave.current?.(true)}>
            {t('Settings.discardAndLeave')}
          </Button>
          <Button tone="secondary" disabled={saving} onClick={() => finishLeave.current?.(false)}>
            {t('Profile.continueEditing')}
          </Button>
        </div>
        {feedback?.kind === 'error' ? (
          <p role="alert" className="mt-3 text-sm text-[var(--nimi-status-danger)]">{feedback.message}</p>
        ) : null}
      </OverlayShell>
    </>
  );

  return (
    <PageShell
      title={preview ? t('Profile.previewProfile') : t('Profile.pageTitle')}
      description={preview ? t('Profile.previewHint') : t('Profile.pageDescription')}
      status={headerActions}
      footer={footer}
      contentClassName="max-w-5xl"
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />

      {preview ? (
        <div className="mx-auto w-full max-w-md">
          <ProfilePreviewCard
            previewProfile={previewProfile}
            formattedHandle={formattedHandle}
            locale={locale}
            visibility={profileVisibility}
            dirty={dirty}
            copiedHandle={copiedHandle}
            testId="profile-draft-preview"
            onOpenFullProfile={onOpenFullProfile}
            onCopyHandle={onCopyHandle ? () => { void handleCopyUsername(); } : undefined}
          />
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
            {/* Module 1: Unified Identity Header Card (Avatar + Read-Only Handle + Web Handoff) */}
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED_AVATAR_TYPES.join(',')}
                  onChange={(event) => { void upload(event); }}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('Profile.changePhoto')}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); if (!busy) setDraggingAvatar(true); }}
                  onDragLeave={() => setDraggingAvatar(false)}
                  onDrop={handleAvatarDrop}
                  className={cn(
                    'group relative h-20 w-20 shrink-0 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-field-focus)] focus-visible:ring-offset-2',
                    draggingAvatar && 'ring-2 ring-[var(--nimi-field-focus)] ring-offset-2',
                  )}
                >
                  <EntityAvatar
                    imageUrl={draft.avatarUrl}
                    media={draft.avatarMedia}
                    name={draft.displayName.trim() || profile.displayName}
                    kind="human"
                    sizeClassName="h-20 w-20"
                    className="ring-1 ring-[var(--nimi-border-subtle)]"
                    fallbackClassName="bg-[var(--nimi-surface-panel)] text-2xl font-semibold text-[var(--nimi-text-secondary)]"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <Camera size={16} />
                  </span>
                </button>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-[var(--nimi-text-primary)]">
                      {draft.displayName.trim() || profile.displayName}
                    </h3>
                    {avatarDirty ? <StatusBadge status="info" text={t('Profile.avatarPendingSave')} /> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      tone="secondary"
                      size="sm"
                      leadingIcon={<Camera size={15} />}
                      onClick={() => fileInput.current?.click()}
                    >
                      {uploading ? t('Profile.avatarUploading') : t('Profile.changePhoto')}
                    </Button>
                    {draft.avatarUrl || draft.avatarResourceId ? (
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => edit({ avatarUrl: null, avatarResourceId: null, avatarMedia: null })}
                      >
                        {t('Profile.removePhoto')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--nimi-text-muted)]">{t('Profile.uploadLimit')}</p>
                </div>
              </div>

              <div className="h-px bg-[var(--nimi-border-subtle)]" />

              {/* Read-Only Handle Identity Row (No Fake Input) */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                      {t('Profile.username')}
                    </span>
                    <span
                      data-testid="profile-readonly-handle"
                      className="font-mono text-sm font-semibold text-[var(--nimi-text-primary)]"
                    >
                      {formattedHandle}
                    </span>
                    {onCopyHandle && formattedHandle ? (
                      <Button
                        tone="ghost"
                        size="sm"
                        leadingIcon={copiedHandle ? <Check size={13} /> : <Copy size={13} />}
                        onClick={() => { void handleCopyUsername(); }}
                      >
                        {copiedHandle ? t('Profile.usernameCopied') : t('Profile.copyUsername')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--nimi-text-muted)]">
                    {t('Profile.usernameWebHandoffHint')}
                  </p>
                </div>
                {onManageUsernameInWeb ? (
                  <Button
                    tone="secondary"
                    size="sm"
                    disabled={openingWeb}
                    trailingIcon={<ExternalLink size={13} />}
                    onClick={() => { void handleOpenWebUsername(); }}
                  >
                    {openingWeb ? t('Profile.openingWebAccount') : t('Profile.manageUsernameInWeb')}
                  </Button>
                ) : null}
              </div>
            </Card>

            {/* Module 2: Basic Presentation (Pure Draft Text Fields) */}
            <Section title={t('Profile.sectionBasicInfo')}>
              <Card>
                <div className="flex flex-col gap-4">
                  <FieldShell
                    label={
                      <span>
                        {t('Profile.displayName')}
                        <span className="ml-0.5 text-[var(--nimi-status-danger)]" aria-hidden="true">*</span>
                      </span>
                    }
                    message={nameErrorText}
                    messageTone={nameErrorText ? 'danger' : 'neutral'}
                  >
                    <TextField
                      ref={displayNameRef}
                      data-testid="profile-edit-name"
                      tone={nameErrorText ? 'danger' : 'default'}
                      value={draft.displayName}
                      placeholder={t('Profile.displayNamePlaceholder')}
                      maxLength={PROFILE_LIMITS.displayName}
                      required
                      onBlur={() => setTouchedName(true)}
                      onChange={(event) => edit({ displayName: event.target.value })}
                    />
                  </FieldShell>

                  <div className="nimi-field-shell flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="profile-edit-bio-field"
                        className="nimi-field-shell__label text-[length:var(--nimi-type-label-size)] font-medium text-[var(--nimi-text-secondary)]"
                      >
                        {t('Profile.bio')}
                      </label>
                      <span
                        className={cn(
                          'text-[length:var(--nimi-type-caption-size)] tabular-nums',
                          bioErrorText
                            ? 'font-medium text-[var(--nimi-status-danger)]'
                            : bioNearLimit
                              ? 'font-medium text-[var(--nimi-status-warning)]'
                              : 'text-[var(--nimi-text-muted)]',
                        )}
                      >
                        {t('Profile.bioCharacterCount', { count: draft.bio.length, max: PROFILE_LIMITS.bio })}
                      </span>
                    </div>
                    <TextareaField
                      ref={bioRef}
                      id="profile-edit-bio-field"
                      data-testid="profile-edit-bio"
                      tone={bioErrorText ? 'danger' : 'default'}
                      value={draft.bio}
                      placeholder={t('Profile.bioPlaceholder')}
                      rows={4}
                      maxLength={PROFILE_LIMITS.bio}
                      onChange={(event) => edit({ bio: event.target.value })}
                    />
                    {bioErrorText ? (
                      <div role="alert" className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]">
                        {bioErrorText}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            </Section>

            {/* Module 3: Optional Details (Aligned Grid + Searchable Country + Chip Editors) */}
            <Section title={t('Profile.optionalDetails')} description={t('Profile.optionalDetailsHint')}>
              <Card>
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
                    <ProfileCountryField
                      label={t('Relationship.country')}
                      emptyLabel={t('Profile.notSpecified')}
                      searchPlaceholder={t('Profile.countrySearchPlaceholder')}
                      noResultsLabel={t('Profile.countryNoResults')}
                      value={draft.countryCode}
                      locale={locale}
                      disabled={busy}
                      onChange={(countryCode) => edit({ countryCode })}
                    />
                    <FieldShell
                      label={t('Relationship.city')}
                      message={cityErrorText}
                      messageTone={cityErrorText ? 'danger' : 'neutral'}
                    >
                      <TextField
                        ref={cityRef}
                        tone={cityErrorText ? 'danger' : 'default'}
                        value={draft.city}
                        placeholder={t('Profile.cityPlaceholder')}
                        maxLength={PROFILE_LIMITS.city}
                        onChange={(event) => edit({ city: event.target.value })}
                      />
                    </FieldShell>
                  </div>

                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <FieldShell label={t('Profile.gender')}>
                      <SelectField
                        aria-label={t('Profile.gender')}
                        value={draft.gender || 'unspecified'}
                        options={[
                          { value: 'unspecified', label: t('Profile.notSpecified') },
                          ...PROFILE_GENDERS.map((value) => ({ value, label: t(`Profile.genderOptions.${value}`) })),
                        ]}
                        onValueChange={(value) => edit({ gender: PROFILE_GENDERS.find((gender) => gender === value) || '' })}
                      />
                    </FieldShell>
                  </div>

                  <ProfileLanguageInput
                    label={t('Profile.languages')}
                    value={draft.languages}
                    locale={locale}
                    maxItems={PROFILE_LIMITS.items}
                    maxItemLength={PROFILE_LIMITS.language}
                    placeholder={t('Profile.languagesInputPlaceholder')}
                    suggestionsHint={t('Profile.languagesSuggestionsHint')}
                    disabled={busy}
                    error={languagesErrorText}
                    removeLabel={(item) => t('Profile.removeChip', { item })}
                    duplicateMessage={t('Profile.chipDuplicate')}
                    maxItemsMessage={t('Profile.editorValidation.languages')}
                    maxLengthMessage={t('Profile.editorValidation.languages')}
                    testId="profile-languages-field"
                    onChange={(languages) => edit({ languages })}
                  />

                  <ProfileTagInput
                    label={t('Relationship.tags')}
                    value={draft.tags}
                    maxItems={PROFILE_LIMITS.items}
                    maxItemLength={PROFILE_LIMITS.tag}
                    placeholder={t('Profile.tagsInputPlaceholder')}
                    disabled={busy}
                    error={tagsErrorText}
                    removeLabel={(item) => t('Profile.removeChip', { item })}
                    duplicateMessage={t('Profile.chipDuplicate')}
                    maxItemsMessage={t('Profile.editorValidation.tags')}
                    maxLengthMessage={t('Profile.editorValidation.tags')}
                    testId="profile-tags-field"
                    onChange={(tags) => edit({ tags })}
                  />
                </div>
              </Card>
            </Section>

            {!dirty && !saving ? (
              <p className="px-1 text-xs text-[var(--nimi-text-muted)]">{t('Profile.explicitSaveHint')}</p>
            ) : null}
          </fieldset>

          {/* Wide Desktop Live Preview Sidebar */}
          <aside className="hidden xl:sticky xl:top-4 xl:block space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-[var(--nimi-text-muted)]">
                {t('Profile.livePreviewTitle')}
              </span>
            </div>
            <ProfilePreviewCard
              previewProfile={previewProfile}
              formattedHandle={formattedHandle}
              locale={locale}
              visibility={profileVisibility}
              dirty={dirty}
              testId="profile-live-preview"
              onOpenFullProfile={onOpenFullProfile}
            />
          </aside>
        </div>
      )}
    </PageShell>
  );
}
