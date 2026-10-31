import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, FieldShell, InlineAlert, TextField } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useCurrentUserProfileProjection } from './current-user-profile.js';

export function ProfileHandleEditor() {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const environment = useAppStore(state => String(state.auth.user?.realmEnvironmentId || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  const applyProfile = useAppStore(state => state.applyCurrentUserProfile);
  const queryClient = useQueryClient();
  const { queryKey: profileKey } = useCurrentUserProfileProjection();
  const eligibility = useQuery({
    queryKey: ['handle-change-eligibility', realmBaseUrl, accountId],
    queryFn: () => bindings.sdk.realm().account.getMyHandleChangeEligibility({ path: {} }),
    enabled: Boolean(accountId),
  });
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const operation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  useEffect(() => () => operation.current?.dispose(), []);
  const rule = eligibility.data;
  const normalized = handle.trim().replace(/^@/, '');
  const valid = Boolean(rule && normalized !== rule.handle.replace(/^@/, '') && normalized.length >= rule.minLength && normalized.length <= rule.maxLength && new RegExp(rule.pattern).test(normalized));
  const changeHandle = async () => {
    if (!confirmation || pending) return;
    const scope = captureAccountActionScope(store);
    if (!scope) { setFeedback({ error: true, message: t('Profile.accountUnavailable') }); return; }
    operation.current = scope; setPending(true); setFeedback(null);
    try {
      const updated = await bindings.sdk.realm().account.updateMyHandle({ path: {}, body: { handle: confirmation } });
      if (!scope.isCurrent()) return;
      queryClient.setQueryData(profileKey, updated); applyProfile({ ...updated }, environment);
      setEditing(false); setConfirmation(null); setHandle('');
      setFeedback({ error: false, message: t('Profile.handleChanged') });
      void eligibility.refetch();
    } catch (error) {
      if (scope.isCurrent()) { setConfirmation(null); setFeedback({ error: true, message: error instanceof Error ? error.message : t('Profile.updateError') }); void eligibility.refetch(); }
    } finally { const current = scope.isCurrent(); scope.dispose(); if (operation.current === scope) operation.current = null; if (current) setPending(false); }
  };
  if (eligibility.isPending) return <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Profile.handleEligibilityLoading')}</p>;
  if (eligibility.isError || !rule) return <div className="space-y-2"><p className="text-sm text-[var(--nimi-text-secondary)]">{t('Profile.handleEligibilityUnavailable')}</p><Button tone="ghost" size="sm" onClick={() => { void eligibility.refetch(); }}>{t('Common.retry')}</Button></div>;
  return <div className="space-y-3">
    {feedback ? <InlineAlert tone={feedback.error ? 'danger' : 'success'}>{feedback.message}</InlineAlert> : null}
    {!rule.canChange ? <p className="text-sm text-[var(--nimi-text-secondary)]">{rule.nextEligibleAt ? t('Profile.handleNextChange', { date: i18n.formatDate(rule.nextEligibleAt, { year: 'numeric', month: 'long', day: 'numeric' }) }) : t('Profile.handleEligibilityUnavailable')}</p> : editing ? <>
      <FieldShell label={t('Profile.newUsername')} description={t('Profile.handleFormat', { min: rule.minLength, max: rule.maxLength })}><TextField autoFocus value={handle} maxLength={rule.maxLength + 1} disabled={pending} onChange={event => { setHandle(event.target.value); setFeedback(null); }} placeholder={rule.handle} /></FieldShell>
      <div className="flex gap-2"><Button tone="secondary" disabled={!valid || pending} onClick={() => setConfirmation(normalized)}>{t('Profile.changeUsername')}</Button><Button tone="ghost" disabled={pending} onClick={() => { setEditing(false); setHandle(''); }}>{t('Common.cancel')}</Button></div>
    </> : <Button tone="ghost" size="sm" onClick={() => setEditing(true)}>{t('Profile.changeUsername')}</Button>}
    <ConfirmDialog open={Boolean(confirmation)} title={t('Profile.confirmUsernameTitle')} message={t('Profile.confirmUsernameBody', { old: rule.handle, next: confirmation })}
      confirmLabel={t('Profile.changeUsername')} cancelLabel={t('Common.cancel')} pending={pending}
      onConfirm={() => { void changeHandle(); }} onClose={() => { if (!pending) setConfirmation(null); }} />
  </div>;
}
