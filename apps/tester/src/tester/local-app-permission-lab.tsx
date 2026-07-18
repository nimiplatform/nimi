import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { testerLocalAppRuntimePlatform } from '../shell/local-app-runtime-platform.js';

const STORAGE_OPERATION_ID = 'app_storage.json.write';
const STORAGE_RELATIVE_PATH = 'local-development/launch-permission-proof.json';
const STORAGE_RESOURCE_REF = `storage:${STORAGE_RELATIVE_PATH}`;

type PermissionEvidence = {
  readonly state: string;
  readonly reasonCode: string;
  readonly actionHint: string;
};

type OperationEvidence = {
  readonly kind: 'idle' | 'success' | 'failure';
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
};

const INITIAL_OPERATION: OperationEvidence = {
  kind: 'idle',
  reasonCode: 'local-app-permission-proof-not-run',
  actionHint: 'run_zero_grant_probe',
  message: '先执行受保护写入；zero-grant 状态必须明确拒绝，不能伪成功。',
};

export function TesterLocalAppPermissionLab() {
  const [sessionState, setSessionState] = useState('checking');
  const [sessionBound, setSessionBound] = useState(false);
  const [permission, setPermission] = useState<PermissionEvidence | null>(null);
  const [operation, setOperation] = useState<OperationEvidence>(INITIAL_OPERATION);
  const [busyAction, setBusyAction] = useState<'refresh' | 'request' | 'write' | null>(null);

  const refresh = useCallback(async () => {
    setBusyAction('refresh');
    try {
      const [session, posture] = await Promise.all([
        testerLocalAppRuntimePlatform.auth.status(),
        testerLocalAppRuntimePlatform.permissions.posture({
          operationId: STORAGE_OPERATION_ID,
          resourceRef: STORAGE_RESOURCE_REF,
        }),
      ]);
      setSessionState(session.state);
      setSessionBound(session.sessionBound);
      setPermission(permissionEvidence(posture));
    } catch (error) {
      const normalized = normalizeOperationError(error);
      setSessionState('unavailable');
      setSessionBound(false);
      setOperation({ kind: 'failure', ...normalized });
    } finally {
      setBusyAction(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    setBusyAction('request');
    try {
      const posture = await testerLocalAppRuntimePlatform.permissions.request({
        operationId: STORAGE_OPERATION_ID,
        resourceRef: STORAGE_RESOURCE_REF,
        purpose: '写入 Nimi Lab 的 local-development 权限回归证明。',
      });
      setPermission(permissionEvidence(posture));
      setOperation({
        kind: 'idle',
        reasonCode: posture.reasonCode,
        actionHint: posture.actionHint,
        message: '请求已提交。请在 Nimi Desktop 完成批准，再刷新真实状态。',
      });
    } catch (error) {
      setOperation({ kind: 'failure', ...normalizeOperationError(error) });
    } finally {
      setBusyAction(null);
    }
  }, []);

  const runProtectedWrite = useCallback(async () => {
    setBusyAction('write');
    try {
      await testerLocalAppRuntimePlatform.storage.writeJson(STORAGE_RELATIVE_PATH, {
        schemaVersion: 1,
        source: 'nimi.tester',
        verifiedAt: new Date().toISOString(),
      });
      setOperation({
        kind: 'success',
        reasonCode: 'local-app-storage-write-succeeded',
        actionHint: 'revoke_in_nimi_desktop_then_retry',
        message: '受保护写入成功。下一步在 Desktop 撤销该 grant，再次执行必须明确拒绝。',
      });
    } catch (error) {
      setOperation({ kind: 'failure', ...normalizeOperationError(error) });
    } finally {
      setBusyAction(null);
      void refresh();
    }
  }, [refresh]);

  const status = useMemo(() => permissionPresentation(permission?.state), [permission?.state]);
  const requestDisabled = busyAction !== null
    || !sessionBound
    || permission?.state === 'pending'
    || permission?.state === 'granted';

  return (
    <div className="grid min-w-0 gap-4 pb-4" data-testid="tester-local-app-permission-lab">
      <InlineAlert tone="warning" icon={<AlertTriangle size={18} aria-hidden="true" />}>
        Nimi grant 只约束 Nimi API，不会把本机开发进程变成系统沙箱。此面板不接收 token、principal、session proof 或 Runtime endpoint。
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
          <EvidenceRow label="Operation" value={STORAGE_OPERATION_ID} />
          <EvidenceRow label="Resource" value={STORAGE_RESOURCE_REF} />
          <EvidenceRow label="Reason code" value={permission?.reasonCode || 'permission-posture-unavailable'} />
          <EvidenceRow label="Action hint" value={permission?.actionHint || 'refresh_local_app_permission'} />
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
            disabled={requestDisabled}
            onClick={() => void requestPermission()}
            className="w-full sm:w-auto"
          >
            请求精确写入权限
          </Button>
          <Button
            type="button"
            tone="primary"
            leadingIcon={operation.kind === 'success'
              ? <CheckCircle2 size={16} aria-hidden="true" />
              : <ShieldCheck size={16} aria-hidden="true" />}
            loading={busyAction === 'write'}
            disabled={busyAction !== null || !sessionBound}
            onClick={() => void runProtectedWrite()}
            className="w-full sm:w-auto"
          >
            执行受保护写入
          </Button>
        </div>
      </Surface>

      <InlineAlert
        tone={operation.kind === 'success' ? 'success' : operation.kind === 'failure' ? 'warning' : 'info'}
        icon={operation.kind === 'success'
          ? <CheckCircle2 size={18} aria-hidden="true" />
          : <AlertTriangle size={18} aria-hidden="true" />}
      >
        <div className="min-w-0" aria-live="polite">
          <strong className="block break-all">{operation.reasonCode}</strong>
          <span className="mt-1 block break-words">{operation.message}</span>
          <span className="mt-1 block break-all text-xs opacity-80">下一步：{operation.actionHint}</span>
        </div>
      </InlineAlert>
    </div>
  );
}

function EvidenceRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--nimi-border-subtle)] pb-2 last:border-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <dt className="text-[var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all font-medium sm:text-right">{value}</dd>
    </div>
  );
}

function permissionEvidence(value: { readonly state: string; readonly reasonCode: string; readonly actionHint: string }): PermissionEvidence {
  return {
    state: value.state,
    reasonCode: value.reasonCode,
    actionHint: value.actionHint,
  };
}

function normalizeOperationError(error: unknown): Omit<OperationEvidence, 'kind'> {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = nonEmptyText(record.reasonCode)
    || nonEmptyText(record.code)
    || (error instanceof Error ? nonEmptyText(error.message) : '')
    || 'local-app-operation-failed';
  return {
    reasonCode,
    actionHint: nonEmptyText(record.actionHint) || 'refresh_local_app_permission',
    message: error instanceof Error ? nonEmptyText(error.message) || reasonCode : reasonCode,
  };
}

function permissionPresentation(state: string | undefined): { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  switch (state) {
    case 'granted': return { label: '已授权', tone: 'success' };
    case 'pending': return { label: '等待 Desktop 批准', tone: 'warning' };
    case 'revoked': return { label: '已撤销', tone: 'danger' };
    case 'denied': return { label: '已拒绝', tone: 'warning' };
    case 'zero-grant': return { label: 'Zero grant', tone: 'neutral' };
    default: return { label: state || '检查中', tone: 'neutral' };
  }
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
