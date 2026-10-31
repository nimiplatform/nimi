import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, FieldShell, OverlayShell, SelectField, TextareaField, TextField } from '@nimiplatform/kit/ui';
import { Camera, Eye, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { Card, FormFeedback, PageShell, Section, StatusBadge } from '../settings/settings-layout-components.js';
import { ProfileCountryField } from '../relationship/profile-country-field.js';
import type { HumanProfileData } from './profile-model.js';
import { buildEditableProfileDraft, previewProfileDraft, profileDraftPatch, profileDraftValidation,
  PROFILE_GENDERS, PROFILE_LIMITS, type EditableProfileDraft } from './profile-edit-model.js';

export type ProfileEditorProps = {
  profile: HumanProfileData;
  onSave: (patch: JsonObject) => Promise<HumanProfileData | null>;
  onUploadAvatar: (file: File) => Promise<Pick<EditableProfileDraft, 'avatarUrl' | 'avatarResourceId' | 'avatarMedia'> | null>;
  usernameAction?: ReactNode;
};

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
// @nimi-authority: rule.nimi.desktop.product-surfaces.public-profile-editor
export function PublicProfileEditor({ profile, onSave, onUploadAvatar, usernameAction }: ProfileEditorProps) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const navigation = useHomeNavigation();
  const [baseline, setBaseline] = useState(() => buildEditableProfileDraft(profile));
  const [draft, setDraft] = useState(baseline);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const finishLeave = useRef<((allow: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const latestOwnerProfile = useRef(profile);
  const dirty = Object.keys(profileDraftPatch(baseline, draft)).length > 0;
  const current = useRef({ dirty, saving, uploading });
  current.current = { dirty, saving, uploading };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; finishLeave.current?.(false); }; }, []);
  useEffect(() => {
    latestOwnerProfile.current = profile;
    if (!current.current.dirty && !current.current.saving && !current.current.uploading) {
      const next = buildEditableProfileDraft(profile);
      setBaseline(next); setDraft(next);
    }
  }, [profile]);
  useEffect(() => navigation.registerLeaveGuard(({ from, signal }) => {
    if (from.id !== 'settings' || !current.current.dirty && !current.current.uploading) return 'allow';
    if (current.current.saving || current.current.uploading) return 'busy';
    return new Promise<'allow' | 'cancel'>(resolve => {
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
  const edit = (patch: Partial<EditableProfileDraft>) => { setDraft(previous => ({ ...previous, ...patch })); setFeedback(null); };
  const save = async (): Promise<boolean> => {
    if (saving || uploading) return false;
    const validation = profileDraftValidation(draft);
    if (validation) {
      setFeedback({ kind: 'error', message: t('Profile.editorValidation.' + validation) });
      return false;
    }
    const patch = profileDraftPatch(baseline, draft);
    if (!Object.keys(patch).length) return true;
    setSaving(true); setFeedback(null);
    try {
      const updated = await onSave(patch);
      if (!mounted.current || !updated) return false;
      latestOwnerProfile.current = updated;
      const next = buildEditableProfileDraft(updated);
      setBaseline(next); setDraft(next); setPreview(false);
      setFeedback({ kind: 'success', message: t('Profile.updateSuccess') });
      return true;
    } catch (error) {
      if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : t('Profile.updateError') });
      return false;
    } finally { if (mounted.current) setSaving(false); }
  };
  const cancel = () => {
    const next = buildEditableProfileDraft(latestOwnerProfile.current);
    setBaseline(next); setDraft(next); setPreview(false); setFeedback(null);
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) { setFeedback({ kind: 'error', message: t('Profile.avatarUnsupportedFormat') }); return; }
    if (file.size > 10 * 1024 * 1024) { setFeedback({ kind: 'error', message: t('Profile.avatarSizeLimit') }); return; }
    setUploading(true); setFeedback(null);
    try {
      const avatar = await onUploadAvatar(file);
      if (mounted.current && avatar) { edit(avatar); setFeedback({ kind: 'success', message: t('Profile.avatarUploadSuccess') }); }
    } catch (error) {
      if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : t('Profile.avatarUploadFailed') });
    } finally { if (mounted.current) setUploading(false); }
  };
  const previewProfile = previewProfileDraft(profile, draft);
  const busy = saving || uploading;
  const footer = <div className="border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-5 py-3">
    <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{saving ? t('Settings.statusSaving') : dirty ? t('Profile.unsavedChanges') : t('Profile.explicitSaveHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button tone="ghost" disabled={busy} leadingIcon={preview ? <Pencil size={16} /> : <Eye size={16} />} onClick={() => setPreview(value => !value)}>{preview ? t('Profile.continueEditing') : t('Profile.previewProfile')}</Button>
        <Button tone="secondary" disabled={busy || !dirty} onClick={cancel}>{t('Common.cancel')}</Button>
        <Button tone="primary" loading={saving} disabled={busy || !dirty} onClick={() => { void save(); }}>{t('Profile.saveProfile')}</Button>
      </div>
    </div>
    <OverlayShell open={leaveOpen} kind="dialog" onClose={() => finishLeave.current?.(false)} title={t('Profile.leaveTitle')}>
      <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Profile.leaveDescription')}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button tone="primary" loading={saving} disabled={busy} onClick={() => { void save().then(ok => { if (ok) finishLeave.current?.(true); }); }}>{t('Profile.saveAndLeave')}</Button>
        <Button tone="danger" disabled={busy} onClick={() => finishLeave.current?.(true)}>{t('Settings.discardAndLeave')}</Button>
        <Button tone="secondary" disabled={saving} onClick={() => finishLeave.current?.(false)}>{t('Profile.continueEditing')}</Button>
      </div>
      {feedback?.kind === 'error' ? <p role="alert" className="mt-3 text-sm text-[var(--nimi-status-danger)]">{feedback.message}</p> : null}
    </OverlayShell>
  </div>;
  return <PageShell title={preview ? t('Profile.previewProfile') : t('Profile.pageTitle')} description={preview ? t('Profile.previewHint') : t('Profile.pageDescription')} footer={footer}
    status={dirty ? <StatusBadge status="info" text={t('Profile.unsavedChanges')} /> : undefined}>
    <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
    {preview ? <Card>
      <div className="flex items-start gap-4" data-testid="profile-draft-preview">
        <EntityAvatar imageUrl={previewProfile.avatarUrl} media={previewProfile.avatarMedia} name={previewProfile.displayName} kind="human" sizeClassName="h-20 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-xl font-semibold">{previewProfile.displayName}</h3>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">@{profile.handle.replace(/^@+/, '')}</p>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm">{previewProfile.bio || t('Profile.noDescription')}</p>
          {[previewProfile.city, previewProfile.countryCode].filter(Boolean).length ? <p className="mt-3 text-sm">{[previewProfile.city, previewProfile.countryCode].filter(Boolean).join(', ')}</p> : null}
          {previewProfile.languages.length ? <p className="mt-3 text-sm">{t('Profile.languages')}: {previewProfile.languages.join('、')}</p> : null}
          {previewProfile.tags.length ? <p className="mt-3 text-sm">{previewProfile.tags.join(' · ')}</p> : null}
        </div>
      </div>
    </Card> : <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
      <Card><div className="flex flex-wrap items-center gap-4">
        <EntityAvatar imageUrl={draft.avatarUrl} media={draft.avatarMedia} name={draft.displayName || profile.displayName} kind="human" sizeClassName="h-20 w-20 shrink-0" />
        <div className="space-y-2">
          <input ref={fileInput} type="file" accept={ACCEPTED_AVATAR_TYPES.join(',')} onChange={event => { void upload(event); }} className="hidden" />
          <div className="flex gap-2"><Button tone="secondary" leadingIcon={<Camera size={16} />} onClick={() => fileInput.current?.click()}>{uploading ? t('Profile.avatarUploading') : t('Profile.changePhoto')}</Button>
            {draft.avatarUrl || draft.avatarResourceId ? <Button tone="ghost" onClick={() => edit({ avatarUrl: null, avatarResourceId: null, avatarMedia: null })}>{t('Profile.removePhoto')}</Button> : null}</div>
          <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Profile.uploadLimit')}</p>
        </div>
      </div></Card>
      <Section title={t('Profile.sectionBasicInfo')}>
        <Card><div className="flex flex-col gap-4">
          <FieldShell label={t('Profile.displayName')}><TextField data-testid="profile-edit-name" value={draft.displayName} maxLength={PROFILE_LIMITS.displayName} required onChange={event => edit({ displayName: event.target.value })} /></FieldShell>
          <FieldShell label={t('Profile.username')} description={t('Profile.usernameIdentityHint')}><TextField value={'@' + profile.handle.replace(/^@+/, '')} readOnly /></FieldShell>
          {usernameAction}
          <FieldShell label={t('Profile.bio')} message={t('Profile.bioCharacterCount', { count: draft.bio.length, max: PROFILE_LIMITS.bio })}><TextareaField data-testid="profile-edit-bio" value={draft.bio} rows={4} maxLength={PROFILE_LIMITS.bio} onChange={event => edit({ bio: event.target.value })} /></FieldShell>
        </div></Card>
      </Section>
      <Section title={t('Profile.optionalDetails')} description={t('Profile.optionalDetailsHint')}>
        <Card><div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <ProfileCountryField label={t('Relationship.country')} emptyLabel={t('Profile.notSpecified')} value={draft.countryCode} locale={i18n.getCurrentLocale()} onChange={countryCode => edit({ countryCode })} />
          <FieldShell label={t('Relationship.city')}><TextField value={draft.city} maxLength={PROFILE_LIMITS.city} onChange={event => edit({ city: event.target.value })} /></FieldShell>
          <FieldShell label={t('Profile.gender')}><SelectField aria-label={t('Profile.gender')} value={draft.gender || 'unspecified'} options={[{ value: 'unspecified', label: t('Profile.notSpecified') }, ...PROFILE_GENDERS.map(value => ({ value, label: t('Profile.genderOptions.' + value) }))]} onValueChange={value => edit({ gender: PROFILE_GENDERS.find(gender => gender === value) || '' })} /></FieldShell>
          <FieldShell label={t('Profile.languages')} description={t('Profile.listEntryHint', { max: PROFILE_LIMITS.items })}><TextField value={draft.languages} placeholder={t('Relationship.languagesPlaceholder')} onChange={event => edit({ languages: event.target.value })} /></FieldShell>
          <div className="sm:col-span-2"><FieldShell label={t('Relationship.tags')} description={t('Profile.listEntryHint', { max: PROFILE_LIMITS.items })}><TextField value={draft.tags} onChange={event => edit({ tags: event.target.value })} /></FieldShell></div>
        </div></Card>
      </Section>
    </fieldset>}
  </PageShell>;
}
