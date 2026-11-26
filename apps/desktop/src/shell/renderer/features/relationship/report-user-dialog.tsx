import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, FieldShell, InlineAlert, OverlayShell, ScrollShell, SelectField, TextareaField } from '@nimiplatform/kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export type ReportUserTarget = { id: string; displayName: string };
export type ReportMessageReference = { chatId: string; messageId: string; previewText?: string | null; attachmentLabel?: string | null };
export type ReportUserDialogProps = { open?: boolean; target: ReportUserTarget | null; message?: ReportMessageReference | null; onClose: () => void };
const REASONS: RealmModel<'ReportReason'>[] = ['SPAM', 'NSFW', 'HATE_SPEECH', 'SCAM', 'OTHER'];

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
export function ReportUserDialog({ open = true, target, message, onClose }: ReportUserDialogProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realm = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  const isOpen = open && target !== null;
  const lastPropsRef = useRef<{ target: ReportUserTarget; message?: ReportMessageReference | null } | null>(null);
  if (target) {
    lastPropsRef.current = { target, message };
  }
  const activeTarget = target ?? lastPropsRef.current?.target ?? null;
  const activeMessage = target ? message : lastPropsRef.current?.message;
  const sessionKey = [realm, accountId, target?.id || '', message?.messageId || ''].join('|');
  const [reason, setReason] = useState<RealmModel<'ReportReason'>>('OTHER');
  const [description, setDescription] = useState('');
  const [includeMessage, setIncludeMessage] = useState(Boolean(message));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RealmModel<'ReportResponseDto'> | null>(null);
  const [copied, setCopied] = useState(false);
  const operation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const lastSessionKeyRef = useRef(sessionKey);

  useEffect(() => {
    if (!isOpen) return;
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey;
      operation.current?.dispose();
      operation.current = null;
      setReason('OTHER');
      setDescription('');
      setIncludeMessage(Boolean(message));
      setPending(false);
      setError(null);
      setReceipt(null);
      setCopied(false);
    }
  }, [isOpen, sessionKey, message]);

  useEffect(() => () => operation.current?.dispose(), []);

  const submit = async () => {
    if (!activeTarget || operation.current || pending || receipt) return;
    const scope = captureAccountActionScope(store);
    if (!scope) { setError(t('Profile.accountUnavailable')); return; }
    operation.current = scope; setPending(true); setError(null);
    try {
      const result = await bindings.sdk.realm().generated.reportControllerCreateReport({
        path: {}, body: { targetType: 'USER', targetId: activeTarget.id, reason,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(activeMessage && includeMessage ? { messageEvidence: { chatId: activeMessage.chatId, messageId: activeMessage.messageId } } : {}),
        },
      });
      if (scope.isCurrent()) setReceipt(result);
    } catch (cause) {
      if (scope.isCurrent()) setError(cause instanceof Error ? cause.message : t('Relationship.report.failed'));
    } finally {
      const current = scope.isCurrent(); scope.dispose(); if (operation.current === scope) operation.current = null;
      if (current) setPending(false);
    }
  };

  return <OverlayShell open={isOpen} kind="dialog" onClose={() => { if (!pending) onClose(); }} title={activeTarget ? t('Relationship.report.title', { name: activeTarget.displayName }) : undefined}>
    {activeTarget ? (
      <div className="space-y-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        {receipt ? <>
          <InlineAlert tone="success">{t('Relationship.report.received')}</InlineAlert>
          <p className="break-all text-sm">{t('Relationship.report.receipt', { id: receipt.id })}</p>
          <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Relationship.report.status', { status: t('Relationship.report.statusLabels.' + receipt.status, { defaultValue: receipt.status }) })}</p>
          <div className="flex gap-2"><Button tone="secondary" onClick={() => { void bindings.app.commands.writeClipboardText(receipt.id).then(() => setCopied(true), () => setError(t('Relationship.report.copyFailed'))); }}>{copied ? t('Relationship.report.copied') : t('Relationship.report.copyReceipt')}</Button><Button onClick={onClose}>{t('Common.close')}</Button></div>
        </> : <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
          <FieldShell label={t('Relationship.report.reason')}><SelectField aria-label={t('Relationship.report.reason')} value={reason} disabled={pending} options={REASONS.map(value => ({ value, label: t('Relationship.report.reasons.' + value) }))}
            onValueChange={value => { const next = REASONS.find(item => item === value); if (next) setReason(next); }} /></FieldShell>
          <FieldShell label={t('Relationship.report.description')} message={description.length + '/500'}><TextareaField value={description} rows={4} maxLength={500} disabled={pending} onChange={event => setDescription(event.target.value)} /></FieldShell>
          {activeMessage ? <div className="space-y-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3">
            <Checkbox
              label={t('Relationship.report.includeMessage')}
              checked={includeMessage}
              disabled={pending}
              onChange={event => setIncludeMessage(event.target.checked)}
            />
            {activeMessage.previewText ? (
              <ScrollShell className="max-h-40">
                <blockquote className="whitespace-pre-wrap break-words text-sm text-[var(--nimi-text-secondary)]">{activeMessage.previewText}</blockquote>
              </ScrollShell>
            ) : null}
            {activeMessage.attachmentLabel ? <p className="text-sm text-[var(--nimi-text-secondary)]">{activeMessage.attachmentLabel}</p> : null}
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Relationship.report.evidenceScope')}</p>
          </div> : null}
          <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Relationship.report.consequence')}</p>
          <div className="flex justify-end gap-2"><Button tone="secondary" disabled={pending} onClick={onClose}>{t('Common.cancel')}</Button><Button type="submit" loading={pending} disabled={pending}>{t('Relationship.report.submit')}</Button></div>
        </form>}
      </div>
    ) : null}
  </OverlayShell>;
}
