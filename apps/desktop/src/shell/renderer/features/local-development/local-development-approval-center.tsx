import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineAlert,
  NimiText,
  OverlayShell,
  ScrollArea,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  decideLocalDevelopmentApproval,
  listPendingLocalDevelopmentApprovals,
  localDevelopmentBridgeAvailable,
  subscribeLocalDevelopmentApprovals,
  type LocalDevelopmentApproval,
  type LocalDevelopmentDecision,
} from './local-development-bridge.js';

export function LocalDevelopmentApprovalCenter() {
  const { t } = useTranslation();
  const authUser = useAppStore((state) => state.auth.user);
  const [approvals, setApprovals] = useState<LocalDevelopmentApproval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const approval = approvals[0] ?? null;
  const reactivation = approval?.approvalState === 'dormant';

  const refresh = useCallback(async () => {
    if (!localDevelopmentBridgeAvailable()) return;
    try {
      setApprovals(await listPendingLocalDevelopmentApprovals());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (!localDevelopmentBridgeAvailable()) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void subscribeLocalDevelopmentApprovals((next) => {
      if (cancelled) return;
      setApprovals((current) => [next, ...current.filter((row) => row.requestId !== next.requestId)]);
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

  const accountLabel = useMemo(
    () => accountDisplayLabel(authUser, approval?.accountId ?? ''),
    [approval?.accountId, authUser],
  );

  const submit = useCallback(async (decision: LocalDevelopmentDecision) => {
    if (!approval || busy) return;
    setBusy(true);
    setError('');
    try {
      await decideLocalDevelopmentApproval(
        approval.requestId,
        decision,
        decision === 'deny' ? false : riskAcknowledged,
      );
      setApprovals((current) => current.filter((row) => row.requestId !== approval.requestId));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [approval, busy, refresh, riskAcknowledged]);

  if (!approval) return null;

  return (
    <OverlayShell
      open
      kind="dialog"
      size="S"
      closeOnBackdrop={false}
      onClose={busy ? undefined : () => { void submit('deny'); }}
      dataTestId="local-development-approval-dialog"
      panelClassName="max-h-[calc(100vh-32px)] overflow-hidden"
      contentClassName="min-h-0"
      title={(
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <NimiText as="h2" role="section-title">
              {t('LocalDevelopment.approval.title')}
            </NimiText>
            <NimiText role="helper" className="mt-1">
              {t('LocalDevelopment.approval.subtitle')}
            </NimiText>
          </div>
          <StatusBadge tone="warning" shape="soft" className="shrink-0">
            {t('LocalDevelopment.trustClass')}
          </StatusBadge>
        </div>
      )}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            tone="danger"
            size="sm"
            disabled={busy}
            data-testid="local-development-deny"
            onClick={() => { void submit('deny'); }}
          >
            {t('LocalDevelopment.action.deny')}
          </Button>
          {!reactivation ? (
            <Button
              tone="secondary"
              size="sm"
              disabled={busy || !riskAcknowledged}
              data-testid="local-development-allow-once"
              onClick={() => { void submit('allow-run-once'); }}
            >
              {t('LocalDevelopment.action.allowOnce')}
            </Button>
          ) : null}
          <Button
            tone="primary"
            size="sm"
            loading={busy}
            disabled={busy || !riskAcknowledged}
            data-testid="local-development-remember"
            onClick={() => { void submit('allow-remember-project'); }}
          >
            {t(reactivation ? 'LocalDevelopment.action.reactivate' : 'LocalDevelopment.action.remember')}
          </Button>
        </div>
      )}
    >
      <ScrollArea className="max-h-[min(520px,calc(100vh-210px))]" contentClassName="grid gap-3 pb-2">
        <InlineAlert tone="warning">
          {t('LocalDevelopment.approval.warning')}
        </InlineAlert>
        <label className="flex cursor-pointer items-start gap-3 rounded-[var(--nimi-radius-md)] border border-[color-mix(in_srgb,var(--nimi-status-warning)_36%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_7%,var(--nimi-surface-card))] px-3 py-3 text-sm leading-6 text-[var(--nimi-text-primary)]">
          <input
            type="checkbox"
            checked={riskAcknowledged}
            disabled={busy}
            data-testid="local-development-native-risk-ack"
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--nimi-action-primary-bg)]"
            onChange={(event) => setRiskAcknowledged(event.currentTarget.checked)}
          />
          <span>{t('LocalDevelopment.approval.nativeRiskAcknowledgement')}</span>
        </label>
        {approvals.length > 1 ? (
          <NimiText role="caption">
            {t('LocalDevelopment.approval.queue', { count: approvals.length })}
          </NimiText>
        ) : null}
        <Surface tone="card" material="solid" padding="md" className="grid gap-3">
          <ApprovalRow label={t('LocalDevelopment.field.app')} value={approval.displayName} secondary={approval.appId} />
          <ApprovalRow label={t('LocalDevelopment.field.projectRoot')} value={approval.canonicalProjectRoot} code />
          <ApprovalRow label={t('LocalDevelopment.field.shell')} value={t(`LocalDevelopment.shell.${approval.shell}`)} />
          <ApprovalRow label={t('LocalDevelopment.field.account')} value={accountLabel} secondary={approval.accountId} />
        </Surface>
        <div className="grid gap-2">
          <NimiText role="label">{t('LocalDevelopment.field.capabilities')}</NimiText>
          <ul className="grid gap-1.5" data-testid="local-development-capabilities">
            {approval.requestedCapabilities.map((capability) => (
              <li
                key={capability}
                className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 font-mono text-xs leading-5 text-[var(--nimi-text-secondary)] break-all"
              >
                {capability}
              </li>
            ))}
          </ul>
        </div>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </ScrollArea>
    </OverlayShell>
  );
}

function ApprovalRow(props: {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
  readonly code?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
      <NimiText role="caption">{props.label}</NimiText>
      <div className="min-w-0">
        <p className={props.code
          ? 'font-mono text-xs leading-5 text-[var(--nimi-text-primary)] break-all'
          : 'text-sm leading-5 text-[var(--nimi-text-primary)] break-words'}
        >
          {props.value}
        </p>
        {props.secondary && props.secondary !== props.value ? (
          <p className="mt-0.5 font-mono text-[11px] leading-4 text-[var(--nimi-text-muted)] break-all">
            {props.secondary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function accountDisplayLabel(user: Record<string, unknown> | null, accountId: string): string {
  for (const field of ['displayName', 'display_name', 'name', 'email', 'handle']) {
    const value = user?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return accountId;
}
