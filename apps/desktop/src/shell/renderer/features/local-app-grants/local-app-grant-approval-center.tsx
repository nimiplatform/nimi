import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, OverlayShell, ScrollArea, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  decideLocalAppGrant,
  listPendingLocalAppGrants,
  localAppGrantBridgeAvailable,
  subscribePendingLocalAppGrants,
  type LocalAppGrantApproval,
} from './local-app-grant-bridge';

export function LocalAppGrantApprovalCenter() {
  const { t } = useTranslation();
  const [approvals, setApprovals] = useState<LocalAppGrantApproval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approval = approvals[0] ?? null;

  const refresh = useCallback(async () => {
    if (!localAppGrantBridgeAvailable()) return;
    try {
      setApprovals(await listPendingLocalAppGrants());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (!localAppGrantBridgeAvailable()) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void refresh();
    void subscribePendingLocalAppGrants((next) => {
      if (!cancelled) {
        setApprovals((current) => [next, ...current.filter((row) => row.selector !== next.selector)]);
      }
    }).then((value) => {
      if (cancelled) value();
      else unsubscribe = value;
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refresh]);

  const decide = useCallback(async (approved: boolean) => {
    if (!approval || busy) return;
    setBusy(true);
    setError('');
    try {
      await decideLocalAppGrant(approval.selector, approved);
      setApprovals((current) => current.filter((row) => row.selector !== approval.selector));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [approval, busy, refresh]);

  if (!approval) return null;

  return (
    <OverlayShell
      open
      kind="dialog"
      size="S"
      closeOnBackdrop={false}
      onClose={busy ? undefined : () => { void decide(false); }}
      dataTestId="local-app-grant-approval-dialog"
      panelClassName="max-h-[calc(100vh-32px)] overflow-hidden"
      contentClassName="min-h-0"
      title={(
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <NimiText as="h2" role="section-title">{t('LocalAppGrants.approval.title')}</NimiText>
            <NimiText role="helper" className="mt-1">{t('LocalAppGrants.approval.subtitle')}</NimiText>
          </div>
          <StatusBadge tone="warning" shape="soft" className="shrink-0">
            {t('LocalAppGrants.approval.pending')}
          </StatusBadge>
        </div>
      )}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            tone="danger"
            size="sm"
            disabled={busy}
            data-testid="local-app-grant-deny"
            onClick={() => { void decide(false); }}
          >
            {t('LocalAppGrants.action.deny')}
          </Button>
          <Button
            tone="primary"
            size="sm"
            loading={busy}
            disabled={busy}
            data-testid="local-app-grant-approve"
            onClick={() => { void decide(true); }}
          >
            {t('LocalAppGrants.action.approve')}
          </Button>
        </div>
      )}
    >
      <ScrollArea className="max-h-[min(520px,calc(100vh-210px))]" contentClassName="grid gap-3 pb-2">
        <InlineAlert tone="warning">{t('LocalAppGrants.approval.warning')}</InlineAlert>
        <Surface tone="card" material="solid" padding="md" className="grid gap-3">
          <GrantRow label={t('LocalAppGrants.field.operation')} value={approval.operationId} />
          <GrantRow label={t('LocalAppGrants.field.resource')} value={approval.resourceRef} />
          <GrantRow
            label={t('LocalAppGrants.field.expires')}
            value={new Date(approval.expiresAtUnixMs).toLocaleString()}
          />
        </Surface>
        {approvals.length > 1 ? (
          <NimiText role="caption">{t('LocalAppGrants.approval.queue', { count: approvals.length })}</NimiText>
        ) : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </ScrollArea>
    </OverlayShell>
  );
}

function GrantRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
      <NimiText role="caption">{props.label}</NimiText>
      <p className="break-all font-mono text-xs leading-5 text-[var(--nimi-text-primary)]">{props.value}</p>
    </div>
  );
}
