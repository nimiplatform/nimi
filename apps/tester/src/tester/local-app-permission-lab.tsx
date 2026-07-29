import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgent, NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { useTesterRendererHost } from '../renderer/context.js';
import {
  isExpectedReservedPermissionError,
  isExpectedRevokedPermissionError,
  normalizeTesterBoundaryError,
} from './local-app-permission-evidence.js';

const INTERACT_PERMISSION_ID = 'agents.interact' as const;
const RESERVED_PERMISSION_ID = 'artifacts.open' as const;
const STORAGE_RELATIVE_PATH = 'authority-lab/app-private-storage.json';

type PermissionEvidence = {
  readonly posture: string;
  readonly canRequest: boolean;
  readonly agents: readonly NimiLocalAppAgent[];
  readonly detail?: string;
};

type BoundaryEvidence = {
  readonly kind: 'idle' | 'success' | 'failure';
  readonly reasonCode: string;
  readonly message: string;
};

const idle = (reasonCode: string, message: string): BoundaryEvidence => ({ kind: 'idle', reasonCode, message });

export function TesterLocalAppPermissionLab() {
  const rendererHost = useTesterRendererHost();
  const [sessionState, setSessionState] = useState('checking');
  const [sessionBound, setSessionBound] = useState(false);
  const [permission, setPermission] = useState<PermissionEvidence | null>(null);
  const [journeyAgentHandle, setJourneyAgentHandle] = useState<NimiLocalAppAgentHandle | null>(null);
  const [lastHandle, setLastHandle] = useState<NimiLocalAppAgentHandle | null>(null);
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);
  const [permissionRequest, setPermissionRequest] = useState(() => idle('permission-request-not-run', 'Prompt 时请求应进入 pending，等待 Desktop owner 决策。'));
  const [conversation, setConversation] = useState(() => idle('conversation-journey-not-run', 'Granted 后从当前 Agent 中选择一个会话目标；该选择不改变账户级授权范围。'));
  const [reservedProbe, setReservedProbe] = useState(() => idle('reserved-probe-not-run', '其它 reserved 权限仍必须 fail-close。'));
  const [storage, setStorage] = useState(() => idle('storage-probe-not-run', 'App 私有 JSON 存储无需 Nimi 权限。'));
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusyAction('refresh');
    try {
      const [session, posture] = await Promise.all([
        rendererHost.app.commands.localAppSessionStatus(),
        rendererHost.app.commands.localAppPermissionStatus(INTERACT_PERMISSION_ID),
      ]);
      setSessionState(session.state);
      setSessionBound(session.sessionBound);
      setPermission(posture);
      setJourneyAgentHandle((current) => {
        if (posture.posture !== 'granted') return null;
        if (current && posture.agents.some((agent) => agent.agentHandle === current)) return current;
        return posture.agents[0]?.agentHandle ?? null;
      });
    } catch (error) {
      setSessionState('unavailable');
      setSessionBound(false);
      setPermissionRequest({ kind: 'failure', ...normalizeBoundaryError(error) });
    } finally {
      setBusyAction(null);
    }
  }, [rendererHost]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestPermission = useCallback(async () => {
    setBusyAction('request');
    try {
      const posture = await rendererHost.app.commands.localAppPermissionRequest({
        permissionId: INTERACT_PERMISSION_ID,
        reason: 'Nimi Lab needs access to all current and future Agents on this account to verify conversation journeys.',
      });
      setPermissionRequest(posture.posture === 'pending'
        ? { kind: 'success', reasonCode: 'owner-decision-pending', message: '账户级请求已进入 pending；请在 Desktop 批准，然后刷新。' }
        : { kind: 'failure', reasonCode: `unexpected-${posture.posture}`, message: `请求返回 ${posture.posture}，未伪造 pending。` });
    } catch (error) {
      setPermissionRequest({ kind: 'failure', ...normalizeBoundaryError(error) });
    } finally {
      setBusyAction(null);
      void refresh();
    }
  }, [refresh, rendererHost]);

  const runConversation = useCallback(async () => {
    const journeyAgent = permission?.agents.find((agent) => agent.agentHandle === journeyAgentHandle);
    if (!journeyAgent) return;
    setBusyAction('conversation');
    try {
      const result = await rendererHost.app.commands.localAppConversationJourney({
        agentHandle: journeyAgent.agentHandle,
        text: 'Tester agents.interact four-operation journey.',
      });
      setLastHandle(journeyAgent.agentHandle);
      setLastAnchor(result.conversationAnchorId);
      setConversation({
        kind: 'success',
        reasonCode: 'conversation-four-operation-journey-succeeded',
        message: `open/send/subscribe/snapshot 成功；anchor=${result.conversationAnchorId}，message=${result.messageId}。`,
      });
    } catch (error) {
      setConversation({ kind: 'failure', ...normalizeBoundaryError(error) });
    } finally {
      setBusyAction(null);
      void refresh();
    }
  }, [journeyAgentHandle, permission?.agents, refresh, rendererHost]);

  const verifyRevokedDenial = useCallback(async () => {
    if (!lastHandle || !lastAnchor) return;
    setBusyAction('revoke');
    try {
      await rendererHost.app.commands.localAppConversationSnapshot({
        agentHandle: lastHandle,
        conversationAnchorId: lastAnchor,
      });
      setConversation({ kind: 'failure', reasonCode: 'revoked-handle-unexpectedly-succeeded', message: '撤销后的同一 handle 不应继续读取 snapshot。' });
    } catch (error) {
      const normalized = normalizeTesterBoundaryError(error);
      setConversation(isExpectedRevokedPermissionError(error)
        ? { kind: 'success', reasonCode: normalized.reasonCode, message: '撤销后同一会话面收到 typed 拒绝。' }
        : { kind: 'failure', ...normalized });
    } finally {
      setBusyAction(null);
      void refresh();
    }
  }, [lastAnchor, lastHandle, refresh, rendererHost]);

  const probeReservedPermission = useCallback(async () => {
    setBusyAction('reserved');
    try {
      const posture = await rendererHost.app.commands.localAppPermissionRequest({
        permissionId: RESERVED_PERMISSION_ID,
        reason: 'Nimi Lab verifies that an unrelated reserved permission remains unavailable.',
      });
      setReservedProbe(posture.posture === 'unavailable'
        ? { kind: 'success', reasonCode: 'reserved-permission-unavailable', message: '其它 reserved 权限保持 unavailable。' }
        : { kind: 'failure', reasonCode: `reserved-unexpected-${posture.posture}`, message: 'Reserved 权限不得进入 owner decision。' });
    } catch (error) {
      const normalized = normalizeTesterBoundaryError(error);
      setReservedProbe(isExpectedReservedPermissionError(error)
        ? { kind: 'success', reasonCode: normalized.reasonCode, message: '其它 reserved 权限在 SDK 边界 fail-close。' }
        : { kind: 'failure', ...normalized });
    } finally {
      setBusyAction(null);
    }
  }, [rendererHost]);

  const runStorageRoundTrip = useCallback(async () => {
    setBusyAction('storage');
    try {
      const result = await rendererHost.app.commands.localAppStorageRoundTrip({
        relativePath: STORAGE_RELATIVE_PATH,
        value: { schemaVersion: 1, source: 'nimi.tester', purpose: 'app-private-base-entitlement-proof' },
      });
      if (!result.removed) throw new Error('App-private storage cleanup failed.');
      setStorage({ kind: 'success', reasonCode: 'storage-round-trip-succeeded', message: `写入、读取和清理成功（${result.sizeBytes} bytes）。` });
    } catch (error) {
      setStorage({ kind: 'failure', ...normalizeBoundaryError(error) });
    } finally {
      setBusyAction(null);
    }
  }, [rendererHost]);

  const status = useMemo(() => permissionPresentation(permission?.posture), [permission?.posture]);
  const busy = busyAction !== null;

  return (
    <div className="grid min-w-0 gap-4 pb-4" data-testid="tester-local-app-permission-lab">
      <InlineAlert tone="info" icon={<ShieldCheck size={18} aria-hidden="true" />}>
        agents.interact 一次授权覆盖账户内全部当前与未来 Agent。下面的 Agent 选择仅决定本次会话测试目标，不改变授权范围；当前没有 Agent 时 Granted 仍然有效。
      </InlineAlert>
      <Surface tone="panel" elevation="raised" padding="lg" className="grid min-w-0 gap-4">
        <div className="flex items-start justify-between gap-3">
          <div><strong>Third-party conversation journey</strong><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">Session：{sessionState} · Identity：{sessionBound ? 'bound' : 'not-bound'}</p></div>
          <StatusBadge tone={status.tone} shape="dot">{status.label}</StatusBadge>
        </div>
        <dl className="grid gap-2 text-sm">
          <EvidenceRow label="Permission" value={INTERACT_PERMISSION_ID} />
          <EvidenceRow label="Posture" value={permission?.posture || 'checking'} />
          <EvidenceRow label="Can request" value={String(permission?.canRequest ?? false)} />
          <EvidenceRow label="Current Agent handles" value={String(permission?.agents.length ?? 0)} />
          <EvidenceRow label="Detail" value={permission?.detail || 'permission-posture-unavailable'} />
        </dl>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">本次会话测试目标（不改变授权范围）</span>
          <select
            value={journeyAgentHandle ?? ''}
            onChange={(event) => setJourneyAgentHandle(event.currentTarget.value as NimiLocalAppAgentHandle)}
            disabled={busy || permission?.posture !== 'granted' || permission.agents.length === 0}
            className="min-h-10 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-bg-panel)] px-3 text-[var(--nimi-text-primary)] disabled:opacity-50"
          >
            {permission?.agents.length
              ? permission.agents.map((agent) => <option key={agent.agentHandle} value={agent.agentHandle}>{agent.displayName}</option>)
              : <option value="">当前没有可用 Agent</option>}
          </select>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" tone="secondary" leadingIcon={<RefreshCw size={16} />} loading={busyAction === 'refresh'} disabled={busy && busyAction !== 'refresh'} onClick={() => void refresh()}>刷新</Button>
          <Button type="button" tone="secondary" leadingIcon={<KeyRound size={16} />} loading={busyAction === 'request'} disabled={busy || !sessionBound || permission?.posture !== 'prompt'} onClick={() => void requestPermission()}>请求账户级 Agent 授权</Button>
          <Button type="button" tone="primary" leadingIcon={<MessageCircle size={16} />} loading={busyAction === 'conversation'} disabled={busy || permission?.posture !== 'granted' || !journeyAgentHandle} onClick={() => void runConversation()}>运行会话四操作</Button>
          <Button type="button" tone="secondary" loading={busyAction === 'revoke'} disabled={busy || permission?.posture !== 'denied' || !lastHandle || !lastAnchor} onClick={() => void verifyRevokedDenial()}>验证撤销后拒绝</Button>
          <Button type="button" tone="secondary" loading={busyAction === 'reserved'} disabled={busy} onClick={() => void probeReservedPermission()}>探针其它 reserved 权限</Button>
          <Button type="button" tone="secondary" leadingIcon={<CheckCircle2 size={16} />} loading={busyAction === 'storage'} disabled={busy || !sessionBound} onClick={() => void runStorageRoundTrip()}>验证私有存储</Button>
        </div>
      </Surface>
      <BoundaryAlert title="权限请求" evidence={permissionRequest} />
      <BoundaryAlert title="会话 / revoke" evidence={conversation} />
      <BoundaryAlert title="Reserved 负向覆盖" evidence={reservedProbe} />
      <BoundaryAlert title="App 私有存储" evidence={storage} />
    </div>
  );
}

function EvidenceRow({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="grid gap-1 border-b border-[var(--nimi-border-subtle)] pb-2 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt className="text-[var(--nimi-text-muted)]">{label}</dt><dd className="break-all font-medium sm:text-right">{value}</dd></div>;
}

function BoundaryAlert({ title, evidence }: { readonly title: string; readonly evidence: BoundaryEvidence }) {
  return <InlineAlert tone={evidence.kind === 'success' ? 'success' : evidence.kind === 'failure' ? 'warning' : 'info'} icon={evidence.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}><div aria-live="polite"><strong className="block break-words">{title} · {evidence.reasonCode}</strong><span className="mt-1 block break-words">{evidence.message}</span></div></InlineAlert>;
}

function normalizeBoundaryError(error: unknown): Omit<BoundaryEvidence, 'kind'> {
  return normalizeTesterBoundaryError(error);
}

function permissionPresentation(posture: string | undefined): { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  switch (posture) {
    case 'granted': return { label: 'Granted', tone: 'success' };
    case 'pending': return { label: 'Pending', tone: 'warning' };
    case 'denied': return { label: 'Denied / revoked', tone: 'danger' };
    case 'unavailable': return { label: 'Unavailable', tone: 'neutral' };
    case 'prompt': return { label: 'Prompt', tone: 'warning' };
    default: return { label: posture || 'Checking', tone: 'neutral' };
  }
}

function nonEmptyText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
