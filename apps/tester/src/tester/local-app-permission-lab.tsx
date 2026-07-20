import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { testerLocalAppClient } from '../shell/local-app-runtime-platform.js';
import { jsonValuesEqual } from '@nimiplatform/kit/core/json-value';

const RESERVED_PERMISSION_ID = 'agents.interact' as const;
const STORAGE_RELATIVE_PATH = 'authority-lab/app-private-storage.json';

type PermissionEvidence = {
  readonly posture: string;
  readonly canRequest: boolean;
  readonly detail?: string;
};

type BoundaryEvidence = {
  readonly kind: 'idle' | 'success' | 'failure';
  readonly reasonCode: string;
  readonly message: string;
};

const INITIAL_PERMISSION_REQUEST: BoundaryEvidence = {
  kind: 'idle',
  reasonCode: 'reserved-permission-probe-not-run',
  message: '请求保留权限时必须 fail-close，不能生成临时 grant 或伪成功。',
};

const INITIAL_STORAGE: BoundaryEvidence = {
  kind: 'idle',
  reasonCode: 'app-private-storage-probe-not-run',
  message: '私有 JSON 存储应在有效 app 会话内直接可用，不需要 Nimi 权限批准。',
};

export function TesterLocalAppPermissionLab() {
  const [sessionState, setSessionState] = useState('checking');
  const [sessionBound, setSessionBound] = useState(false);
  const [permission, setPermission] = useState<PermissionEvidence | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<BoundaryEvidence>(INITIAL_PERMISSION_REQUEST);
  const [storage, setStorage] = useState<BoundaryEvidence>(INITIAL_STORAGE);
  const [busyAction, setBusyAction] = useState<'refresh' | 'request' | 'storage' | null>(null);

  const refresh = useCallback(async () => {
    setBusyAction('refresh');
    try {
      const [session, posture] = await Promise.all([
        testerLocalAppClient.auth.status(),
        testerLocalAppClient.permissions.status(RESERVED_PERMISSION_ID),
      ]);
      setSessionState(session.state);
      setSessionBound(session.sessionBound);
      setPermission({
        posture: posture.posture,
        canRequest: posture.canRequest,
        detail: posture.detail,
      });
    } catch (error) {
      const normalized = normalizeBoundaryError(error);
      setSessionState('unavailable');
      setSessionBound(false);
      setStorage({ kind: 'failure', ...normalized });
    } finally {
      setBusyAction(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestReservedPermission = useCallback(async () => {
    setBusyAction('request');
    try {
      const posture = await testerLocalAppClient.permissions.request({
        permissionId: RESERVED_PERMISSION_ID,
        reason: 'Tester verifies that reserved permissions cannot be requested before atomic admission.',
      });
      setPermissionRequest({
        kind: 'failure',
        reasonCode: 'reserved-permission-unexpectedly-returned',
        message: `保留权限请求不应返回 ${posture.posture}。`,
      });
    } catch (error) {
      const normalized = normalizeBoundaryError(error);
      setPermissionRequest({
        kind: 'success',
        reasonCode: normalized.reasonCode,
        message: '保留权限按设计被拒绝；没有创建 owner decision、grant 或可携带凭据。',
      });
    } finally {
      setBusyAction(null);
    }
  }, []);

  const runStorageRoundTrip = useCallback(async () => {
    setBusyAction('storage');
    try {
      const value = {
        schemaVersion: 1,
        source: 'nimi.tester',
        purpose: 'app-private-base-entitlement-proof',
      } as const;
      const written = await testerLocalAppClient.storage.writeJson(STORAGE_RELATIVE_PATH, value);
      const read = await testerLocalAppClient.storage.readJson(STORAGE_RELATIVE_PATH);
      if (!jsonValuesEqual(read.value, value)) {
        throw new Error('App-private storage readback did not match the written value.');
      }
      const removed = await testerLocalAppClient.storage.removeJson(STORAGE_RELATIVE_PATH);
      if (!removed.removed) throw new Error('App-private storage cleanup did not remove the written document.');
      setStorage({
        kind: 'success',
        reasonCode: 'app-private-base-entitlement-round-trip-succeeded',
        message: `写入、读取和清理成功（${written.sizeBytes} bytes）；全程没有权限请求。`,
      });
    } catch (error) {
      setStorage({ kind: 'failure', ...normalizeBoundaryError(error) });
    } finally {
      setBusyAction(null);
      void refresh();
    }
  }, [refresh]);

  const status = useMemo(() => permissionPresentation(permission?.posture), [permission?.posture]);

  return (
    <div className="grid min-w-0 gap-4 pb-4" data-testid="tester-local-app-permission-lab">
      <InlineAlert tone="info" icon={<ShieldCheck size={18} aria-hidden="true" />}>
        Nimi 权限只约束 Nimi、Realm、Agent、Cognition 或其他 app 拥有的资源。app 自有 SQLite、媒体、设置、路由、命令和私有存储不进入 Nimi 权限系统。
      </InlineAlert>

      <Surface tone="panel" elevation="raised" padding="lg" className="grid min-w-0 gap-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>受保护 local-app session</span>
            </div>
            <p className="mt-2 break-words text-sm text-[var(--nimi-text-secondary)]">
              Session：{sessionState} · Identity：{sessionBound ? 'bound' : 'not-bound'}
            </p>
          </div>
          <StatusBadge tone={status.tone} shape="dot">{status.label}</StatusBadge>
        </div>

        <dl className="grid min-w-0 gap-2 text-sm">
          <EvidenceRow label="Reserved permission" value={RESERVED_PERMISSION_ID} />
          <EvidenceRow label="Posture" value={permission?.posture || 'checking'} />
          <EvidenceRow label="Can request" value={String(permission?.canRequest ?? false)} />
          <EvidenceRow label="Detail" value={permission?.detail || 'permission-posture-unavailable'} />
          <EvidenceRow label="Private path" value={STORAGE_RELATIVE_PATH} />
        </dl>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            tone="secondary"
            leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
            loading={busyAction === 'refresh'}
            disabled={busyAction !== null && busyAction !== 'refresh'}
            onClick={() => void refresh()}
            className="w-full sm:w-auto"
          >
            刷新真实状态
          </Button>
          <Button
            type="button"
            tone="secondary"
            leadingIcon={<KeyRound size={16} aria-hidden="true" />}
            loading={busyAction === 'request'}
            disabled={busyAction !== null || !sessionBound}
            onClick={() => void requestReservedPermission()}
            className="w-full sm:w-auto"
          >
            请求保留权限（应拒绝）
          </Button>
          <Button
            type="button"
            tone="primary"
            leadingIcon={<CheckCircle2 size={16} aria-hidden="true" />}
            loading={busyAction === 'storage'}
            disabled={busyAction !== null || !sessionBound}
            onClick={() => void runStorageRoundTrip()}
            className="w-full sm:w-auto"
          >
            验证私有存储（应成功）
          </Button>
        </div>
      </Surface>

      <BoundaryAlert title="保留权限请求" evidence={permissionRequest} />
      <BoundaryAlert title="App 私有存储" evidence={storage} />
    </div>
  );
}

function EvidenceRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--nimi-border-subtle)] pb-2 last:border-0 last:pb-0 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className="text-[var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all font-medium sm:text-right">{value}</dd>
    </div>
  );
}

function BoundaryAlert({ title, evidence }: { readonly title: string; readonly evidence: BoundaryEvidence }) {
  return (
    <InlineAlert
      tone={evidence.kind === 'success' ? 'success' : evidence.kind === 'failure' ? 'warning' : 'info'}
      icon={evidence.kind === 'success'
        ? <CheckCircle2 size={18} aria-hidden="true" />
        : <AlertTriangle size={18} aria-hidden="true" />}
    >
      <div className="min-w-0" aria-live="polite">
        <strong className="block break-words">{title} · {evidence.reasonCode}</strong>
        <span className="mt-1 block break-words">{evidence.message}</span>
      </div>
    </InlineAlert>
  );
}

function normalizeBoundaryError(error: unknown): Omit<BoundaryEvidence, 'kind'> {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = nonEmptyText(record.reasonCode)
    || nonEmptyText(record.code)
    || (error instanceof Error ? nonEmptyText(error.message) : '')
    || 'local-app-boundary-check-failed';
  return {
    reasonCode,
    message: error instanceof Error ? nonEmptyText(error.message) || reasonCode : reasonCode,
  };
}

function permissionPresentation(posture: string | undefined): { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  switch (posture) {
    case 'granted': return { label: 'Granted', tone: 'success' };
    case 'pending': return { label: 'Pending', tone: 'warning' };
    case 'denied': return { label: 'Denied', tone: 'danger' };
    case 'unavailable': return { label: 'Reserved / unavailable', tone: 'neutral' };
    case 'prompt': return { label: 'Prompt', tone: 'warning' };
    default: return { label: posture || 'Checking', tone: 'neutral' };
  }
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
