import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DelegatedApprovalRequestState,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedDiagnostic,
  type DelegatedReplayTrace,
} from '@nimiplatform/sdk/runtime/wire-types';
import { ScrollArea, Surface, cn } from '@nimiplatform/kit/ui';
import { Button, Input } from './runtime-config-primitives';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
} from './runtime-config-runtime-page-ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  createDesktopDelegatedControlService,
} from './runtime-config-delegated-capability-service';

function approvalStateLabel(value: unknown): string {
  if (typeof value !== 'number') return 'unknown';
  const label = (DelegatedApprovalRequestState as unknown as { [key: number]: string })[value];
  return String(label || 'unknown').replace(/^DELEGATED_APPROVAL_REQUEST_STATE_/, '').toLowerCase();
}

function isPendingApproval(value: unknown): boolean {
  return value === DelegatedApprovalRequestState.PENDING;
}

function compactEvidence(values: Array<[string, unknown]>): string {
  return values
    .map(([label, value]) => {
      const text = String(value || '').trim();
      return text ? `${label}=${text}` : '';
    })
    .filter(Boolean)
    .join(' | ');
}

export function DelegatedCapabilityControlPanel() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [localAgentRef, setLocalAgentRef] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [runtimeSourceRef, setRuntimeSourceRef] = useState('');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [conversationAnchorId, setConversationAnchorId] = useState('');
  const [snapshot, setSnapshot] = useState<DelegatedControlSurfaceSnapshot | undefined>();
  const [replayTrace, setReplayTrace] = useState<DelegatedReplayTrace | undefined>();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const service = useMemo(() => createDesktopDelegatedControlService({
    getRuntime: bindings.sdk.hostRuntimeAgent,
    getSubjectUserId: async () => subjectUserId,
    withScopes: bindings.sdk.withRuntimeProtectedScopes,
  }), [bindings.sdk, subjectUserId]);

  const identityInput = {
    localAgentRef: localAgentRef.trim(),
    ownerUserId: ownerUserId.trim(),
    runtimeSourceRef: runtimeSourceRef.trim(),
  };
  const canCall = Boolean(
    identityInput.localAgentRef
      && identityInput.ownerUserId
      && identityInput.runtimeSourceRef
      && subjectUserId.trim(),
  );
  const pendingApprovals = (snapshot?.approvalRequests || []).filter((approval) => isPendingApproval(approval.state));

  const refreshSnapshot = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      const loaded = await service.loadSnapshot({ ...identityInput, conversationAnchorId });
      setSnapshot(loaded);
      setReplayTrace(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || 'DELEGATED_CAPABILITY_REFRESH_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  const submitApproval = async (approvalRequestId: string, decision: 'approve' | 'reject') => {
    setBusy(true);
    setErrorMessage('');
    try {
      await service.submitApprovalDecision({
        ...identityInput,
        approvalRequestId,
        decision,
        decisionReason: 'desktop control surface',
      });
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || 'DELEGATED_APPROVAL_DECISION_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  const loadReplayTrace = async (diagnostic: DelegatedDiagnostic) => {
    setBusy(true);
    setErrorMessage('');
    try {
      const loaded = await service.loadReplayTrace({
        ...identityInput,
        decisionId: diagnostic.diagnosticId,
        conversationAnchorId: diagnostic.conversationAnchorId || conversationAnchorId,
        turnId: diagnostic.turnId,
      });
      setReplayTrace(loaded);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || 'DELEGATED_REPLAY_LOAD_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6">
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'overflow-hidden p-5')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
              {t('runtimeConfig.delegation.title', { defaultValue: 'Delegated capability control' })}
            </h3>
            <div className={cn('mt-2 flex flex-wrap gap-2 text-xs', TOKEN_TEXT_MUTED)}>
              <span>{t('runtimeConfig.delegation.agentChat', { defaultValue: 'Agent chat' })}</span>
              <span>{t('runtimeConfig.delegation.avatarConfig', { defaultValue: 'Avatar config' })}</span>
              <span>{t('runtimeConfig.delegation.connectorConfig', { defaultValue: 'Connector config' })}</span>
              <span>{t('runtimeConfig.delegation.debugWorkbench', { defaultValue: 'Debug workbench' })}</span>
              <span>{t('runtimeConfig.delegation.approvalUx', { defaultValue: 'Approval' })}</span>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refreshSnapshot()} disabled={!canCall || busy}>
            {busy
              ? t('runtimeConfig.delegation.refreshing', { defaultValue: 'Refreshing' })
              : t('runtimeConfig.delegation.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <Input label={t('runtimeConfig.delegation.localAgentRef', { defaultValue: 'LocalAgent Ref' })} value={localAgentRef} onChange={setLocalAgentRef} placeholder="local-agent:desktop:..." disabled={busy} />
          <Input label={t('runtimeConfig.delegation.ownerUserId', { defaultValue: 'Owner User ID' })} value={ownerUserId} onChange={setOwnerUserId} placeholder="user-1" disabled={busy} />
          <Input label={t('runtimeConfig.delegation.runtimeSourceRef', { defaultValue: 'Runtime Source Ref' })} value={runtimeSourceRef} onChange={setRuntimeSourceRef} placeholder="runtime-source:..." disabled={busy} />
          <Input label={t('runtimeConfig.delegation.subjectUserId', { defaultValue: 'Subject User ID' })} value={subjectUserId} onChange={setSubjectUserId} placeholder="user-1" disabled={busy} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Input label={t('runtimeConfig.delegation.anchorId', { defaultValue: 'Conversation Anchor ID' })} value={conversationAnchorId} onChange={setConversationAnchorId} placeholder="anchor-1" disabled={busy} />
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-5">
          <div className="space-y-4">
            <MetricRow
              approvals={pendingApprovals.length}
              diagnostics={snapshot?.diagnostics?.length || 0}
            />
            <div className="space-y-2">
              {(snapshot?.approvalRequests || []).map((approval) => (
                <div key={approval.approvalRequestId} className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className={cn('truncate text-sm font-medium', TOKEN_TEXT_PRIMARY)}>{approval.toolName || approval.capabilityId}</div>
                      <div className={cn('truncate text-xs', TOKEN_TEXT_MUTED)}>
                        {compactEvidence([
                          ['state', approvalStateLabel(approval.state)],
                          ['firewallVerdict', approval.firewallVerdict],
                          ['reasonCode', approval.reasonCode],
                        ])}
                      </div>
                    </div>
                    {isPendingApproval(approval.state) ? (
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void submitApproval(approval.approvalRequestId, 'reject')} disabled={busy}>
                          {t('runtimeConfig.delegation.reject', { defaultValue: 'Reject' })}
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => void submitApproval(approval.approvalRequestId, 'approve')} disabled={busy}>
                          {t('runtimeConfig.delegation.approve', { defaultValue: 'Approve' })}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <ScrollArea className="max-h-40 rounded-lg border border-[var(--nimi-border-subtle)]" viewportClassName="px-3 py-2" contentClassName="text-xs">
              {(snapshot?.diagnostics || []).length > 0 ? (
                (snapshot?.diagnostics || []).map((item) => (
                  <div key={item.diagnosticId} className="border-b border-[var(--nimi-border-subtle)] py-1 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className={TOKEN_TEXT_PRIMARY}>{item.toolName || item.capabilityId}</span>{' '}
                        <span className={TOKEN_TEXT_MUTED}>
                          {compactEvidence([
                            ['gatewayEvidenceId', item.gatewayEvidenceId],
                            ['firewallInputId', item.firewallInputId],
                            ['firewallVerdict', item.firewallVerdict],
                            ['runtimeDecision', item.runtimeDecision],
                            ['reasonCode', item.reasonCode],
                          ])}
                        </span>
                      </span>
                      <Button variant="secondary" size="sm" onClick={() => void loadReplayTrace(item)} disabled={busy}>
                        {t('runtimeConfig.delegation.replay', { defaultValue: 'Replay' })}
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <span className={TOKEN_TEXT_MUTED}>{t('runtimeConfig.delegation.noDiagnostics', { defaultValue: 'No diagnostics' })}</span>
              )}
            </ScrollArea>
            {replayTrace ? (
              <div className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-2 text-xs">
                <div className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>
                  {t('runtimeConfig.delegation.replayTrace', { defaultValue: 'Replay trace' })}
                </div>
                <div className={cn('mt-1', TOKEN_TEXT_MUTED)}>
                  {replayTrace.outcome} - {replayTrace.projectionDisposition || 'not_projected'} - {replayTrace.actionDisposition || 'not_admitted'}
                </div>
                <div className="mt-2 space-y-1">
                  {(replayTrace.stages || []).map((stage, index) => (
                    <div key={`${stage.kind}-${stage.stageId || index}`} className="rounded-md bg-[var(--nimi-surface-panel)] px-2 py-1">
                      <div className={TOKEN_TEXT_PRIMARY}>{stage.state || stage.stageId}</div>
                      <div className={TOKEN_TEXT_MUTED}>{stage.redactedSummary || stage.reasonCode}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Surface>
    </section>
  );
}

function MetricRow({ approvals, diagnostics }: { approvals: number; diagnostics: number }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        [t('runtimeConfig.delegation.pending', { defaultValue: 'Pending' }), approvals],
        [t('runtimeConfig.delegation.diagnostics', { defaultValue: 'Diagnostics' }), diagnostics],
      ].map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-2">
          <div className={cn('text-lg font-semibold', TOKEN_TEXT_PRIMARY)}>{value}</div>
          <div className={cn('text-xs', TOKEN_TEXT_MUTED)}>{label}</div>
        </div>
      ))}
    </div>
  );
}
