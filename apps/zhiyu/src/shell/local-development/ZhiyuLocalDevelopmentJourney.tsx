import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  MessageCircleOff,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import type { ZhiyuSelectedLocalDevelopmentTarget } from '../app/evidence-window';
import { zhiyuLocalAppClient } from './local-app-runtime-platform';

const RESERVED_PERMISSION_ID = 'agents.interact' as const;
const STORAGE_RELATIVE_PATH = 'zhiyu/local-development-authority-proof.json';

type JourneyState =
  | 'loading'
  | 'session-bound'
  | 'app-private-storage-ready'
  | 'permission-request-rejected'
  | 'runtime-unavailable'
  | 'error';

type PermissionEvidence = {
  readonly permissionId: typeof RESERVED_PERMISSION_ID;
  readonly posture: string;
  readonly canRequest: boolean;
  readonly detail: string;
};

type BoundaryEvidence = {
  readonly state: 'not-run' | 'succeeded' | 'rejected' | 'failed';
  readonly reasonCode: string;
  readonly message: string;
};

type JourneyErrorEvidence = {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type ZhiyuDevKernelEvidence = {
  readonly profile: 'isolated-local-development';
  readonly state: JourneyState;
  readonly agentId: string;
  readonly buildMarker: string;
  readonly session: {
    readonly state: string;
    readonly sessionBound: boolean;
    readonly reasonCode: string;
    readonly retryable: boolean;
  } | null;
  readonly permission: PermissionEvidence | null;
  readonly permissionRequest: BoundaryEvidence;
  readonly appPrivateStorage: BoundaryEvidence & {
    readonly relativePath: typeof STORAGE_RELATIVE_PATH;
  };
  readonly productRoute: {
    readonly available: false;
    readonly reasonCode: 'agents-interact-not-admitted';
    readonly actionHint: 'wait_for_agents_interact_admission';
  };
  readonly lastError: JourneyErrorEvidence | null;
};

type JourneyView = ZhiyuDevKernelEvidence & {
  readonly busyAction: 'refresh' | 'permission' | 'storage' | null;
};

const INITIAL_PERMISSION_REQUEST: BoundaryEvidence = {
  state: 'not-run',
  reasonCode: 'reserved-permission-request-not-run',
  message: '保留权限尚未准入，因此请求必须 fail-close。',
};

const INITIAL_STORAGE: ZhiyuDevKernelEvidence['appPrivateStorage'] = {
  state: 'not-run',
  reasonCode: 'app-private-storage-check-not-run',
  message: '应用私有存储属于基础权益，不需要 Nimi 权限批准。',
  relativePath: STORAGE_RELATIVE_PATH,
};

export function ZhiyuLocalDevelopmentJourney({
  target,
}: {
  readonly target: ZhiyuSelectedLocalDevelopmentTarget;
}) {
  const [view, setView] = useState<JourneyView>(() => ({
    profile: 'isolated-local-development',
    state: 'loading',
    agentId: target.agentId,
    buildMarker: target.buildMarker,
    session: null,
    permission: null,
    permissionRequest: INITIAL_PERMISSION_REQUEST,
    appPrivateStorage: INITIAL_STORAGE,
    productRoute: {
      available: false,
      reasonCode: 'agents-interact-not-admitted',
      actionHint: 'wait_for_agents_interact_admission',
    },
    lastError: null,
    busyAction: 'refresh',
  }));

  const refresh = useCallback(async () => {
    setView((current) => ({ ...current, state: 'loading', busyAction: 'refresh', lastError: null }));
    try {
      const [session, permission] = await Promise.all([
        zhiyuLocalAppClient.auth.status(),
        zhiyuLocalAppClient.permissions.status(RESERVED_PERMISSION_ID),
      ]);
      setView((current) => ({
        ...current,
        state: session.sessionBound ? 'session-bound' : 'runtime-unavailable',
        session: {
          state: session.state,
          sessionBound: session.sessionBound,
          reasonCode: session.reasonCode,
          retryable: session.retryable,
        },
        permission: {
          permissionId: RESERVED_PERMISSION_ID,
          posture: permission.posture,
          canRequest: permission.canRequest,
          detail: permission.detail || 'permission-detail-unavailable',
        },
        busyAction: null,
      }));
    } catch (error) {
      const normalized = normalizeJourneyError(error);
      setView((current) => ({
        ...current,
        state: normalized.reasonCode === 'runtime-service-unavailable' ? 'runtime-unavailable' : 'error',
        session: null,
        permission: null,
        lastError: normalized,
        busyAction: null,
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const { busyAction: _busyAction, ...evidence } = view;
    window.__nimiZhiyuDevKernelEvidence = evidence;
    return () => {
      delete window.__nimiZhiyuDevKernelEvidence;
    };
  }, [view]);

  const verifyReservedPermission = useCallback(async () => {
    setView((current) => ({ ...current, busyAction: 'permission', lastError: null }));
    try {
      const unexpected = await zhiyuLocalAppClient.permissions.request({
        permissionId: RESERVED_PERMISSION_ID,
        reason: 'Zhiyu local development verifies reserved-permission fail-close behavior.',
      });
      setView((current) => ({
        ...current,
        state: 'error',
        permissionRequest: {
          state: 'failed',
          reasonCode: 'reserved-permission-unexpectedly-returned',
          message: `保留权限请求意外返回 ${unexpected.posture}。`,
        },
        lastError: {
          reasonCode: 'reserved-permission-unexpectedly-returned',
          actionHint: 'inspect_permission_admission_boundary',
          message: '保留权限不得生成 owner decision、grant 或临时成功。',
          retryable: false,
        },
        busyAction: null,
      }));
    } catch (error) {
      const normalized = normalizeJourneyError(error);
      setView((current) => ({
        ...current,
        state: 'permission-request-rejected',
        permissionRequest: {
          state: 'rejected',
          reasonCode: normalized.reasonCode,
          message: '保留权限按设计被拒绝，未产生授权状态或可携带凭据。',
        },
        busyAction: null,
      }));
    }
  }, []);

  const verifyAppPrivateStorage = useCallback(async () => {
    setView((current) => ({ ...current, busyAction: 'storage', lastError: null }));
    try {
      const value = {
        schemaVersion: 1,
        appId: 'nimi.zhiyu',
        purpose: 'app-private-base-entitlement-proof',
      } as const;
      const written = await zhiyuLocalAppClient.storage.writeJson(STORAGE_RELATIVE_PATH, value);
      const read = await zhiyuLocalAppClient.storage.readJson(STORAGE_RELATIVE_PATH);
      if (JSON.stringify(read.value) !== JSON.stringify(value)) {
        throw boundaryError('app-private-storage-readback-mismatch', 'inspect_app_private_storage');
      }
      const removed = await zhiyuLocalAppClient.storage.removeJson(STORAGE_RELATIVE_PATH);
      if (!removed.removed) {
        throw boundaryError('app-private-storage-cleanup-failed', 'inspect_app_private_storage');
      }
      setView((current) => ({
        ...current,
        state: 'app-private-storage-ready',
        appPrivateStorage: {
          state: 'succeeded',
          reasonCode: 'app-private-base-entitlement-round-trip-succeeded',
          message: `写入、读取和清理成功（${written.sizeBytes} bytes），全程没有权限请求。`,
          relativePath: STORAGE_RELATIVE_PATH,
        },
        busyAction: null,
      }));
    } catch (error) {
      const normalized = normalizeJourneyError(error);
      setView((current) => ({
        ...current,
        state: 'error',
        appPrivateStorage: {
          state: 'failed',
          reasonCode: normalized.reasonCode,
          message: normalized.message,
          relativePath: STORAGE_RELATIVE_PATH,
        },
        lastError: normalized,
        busyAction: null,
      }));
    }
  }, []);

  const presentation = useMemo(() => statusPresentation(view), [view]);
  const sessionBound = view.session?.sessionBound === true;

  return (
    <main
      className="min-h-screen min-w-0 bg-[var(--nimi-bg-canvas)] px-4 py-5 text-[var(--nimi-text-primary)] sm:px-6"
      data-testid="zhiyu-dev-kernel-root"
    >
      <div className="mx-auto grid w-full max-w-4xl min-w-0 gap-4">
        <Surface tone="panel" elevation="raised" padding="lg" className="grid min-w-0 gap-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <ShieldCheck size={20} aria-hidden="true" />
                <h1>Zhiyu 本地应用权限边界</h1>
              </div>
              <p className="mt-2 break-words text-sm text-[var(--nimi-text-secondary)]">
                应用私有数据直接可用；访问 Nimi、Realm、Agent 或其他应用资源时才进入权限系统。
              </p>
            </div>
            <StatusBadge tone={presentation.tone} shape="dot">{presentation.label}</StatusBadge>
          </div>

          {view.state === 'loading' ? (
            <LoadingSkeleton lines={4} data-testid="zhiyu-dev-kernel-loading" />
          ) : (
            <dl className="grid min-w-0 gap-2 text-sm" data-testid="zhiyu-dev-kernel-status">
              <EvidenceRow label="App" value="nimi.zhiyu" />
              <EvidenceRow label="Agent reference" value={view.agentId} />
              <EvidenceRow label="Build" value={view.buildMarker} />
              <EvidenceRow label="Session" value={view.session?.state || 'unavailable'} />
              <EvidenceRow label="Identity binding" value={sessionBound ? 'bound' : 'not-bound'} />
              <EvidenceRow label="Permission" value={RESERVED_PERMISSION_ID} />
              <EvidenceRow label="Permission posture" value={view.permission?.posture || 'unavailable'} />
              <EvidenceRow label="Can request" value={String(view.permission?.canRequest ?? false)} />
              <EvidenceRow label="Private storage" value={STORAGE_RELATIVE_PATH} />
            </dl>
          )}

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              tone="secondary"
              leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
              loading={view.busyAction === 'refresh'}
              disabled={view.busyAction !== null && view.busyAction !== 'refresh'}
              onClick={() => void refresh()}
              className="w-full sm:w-auto"
              data-testid="zhiyu-dev-kernel-refresh"
            >
              刷新真实状态
            </Button>
            <Button
              type="button"
              tone="primary"
              leadingIcon={<Database size={16} aria-hidden="true" />}
              loading={view.busyAction === 'storage'}
              disabled={!sessionBound || view.busyAction !== null}
              onClick={() => void verifyAppPrivateStorage()}
              className="w-full sm:w-auto"
              data-testid="zhiyu-dev-kernel-verify-private-storage"
            >
              验证私有存储（应成功）
            </Button>
            <Button
              type="button"
              tone="secondary"
              leadingIcon={<KeyRound size={16} aria-hidden="true" />}
              loading={view.busyAction === 'permission'}
              disabled={!sessionBound || view.busyAction !== null || view.permission?.canRequest === true}
              onClick={() => void verifyReservedPermission()}
              className="w-full sm:w-auto"
              data-testid="zhiyu-dev-kernel-verify-reserved-permission"
            >
              验证保留权限（应拒绝）
            </Button>
          </div>
        </Surface>

        <InlineAlert tone="success" icon={<CheckCircle2 size={18} aria-hidden="true" />}>
          <strong className="block">App-owned authority</strong>
          <span className="mt-1 block break-words">
            SQLite、媒体、设置、产品路由、产品命令和私有文件属于应用自身，不进入 Nimi 权限目录。
          </span>
        </InlineAlert>

        <InlineAlert tone="warning" icon={<MessageCircleOff size={18} aria-hidden="true" />}>
          <strong className="block">Agent 交互尚未准入</strong>
          <span className="mt-1 block break-words">
            `agents.interact` 当前为 reserved / unavailable。Zhiyu 不会把普通 gRPC、local-app carrier 或应用自持 token 当作替代授权。
          </span>
        </InlineAlert>

        <Surface tone="panel" padding="lg" className="grid min-w-0 gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <MessageCircleOff size={18} aria-hidden="true" />
            <span>对话功能</span>
          </div>
          <p className="break-words text-sm text-[var(--nimi-text-secondary)]">
            需要读取或修改 Runtime Agent 资源，必须等待公开权限原子准入；当前入口保持禁用。
          </p>
          <Button type="button" tone="secondary" disabled data-testid="zhiyu-dev-kernel-send">
            Agent 交互未准入
          </Button>
        </Surface>

        <BoundaryAlert title="应用私有存储" evidence={view.appPrivateStorage} />
        <BoundaryAlert title="保留权限请求" evidence={view.permissionRequest} />

        {view.lastError ? (
          <InlineAlert
            tone="danger"
            icon={<AlertTriangle size={18} aria-hidden="true" />}
            data-testid="zhiyu-dev-kernel-error"
          >
            <strong className="block break-words">{view.lastError.reasonCode}</strong>
            <span className="mt-1 block break-words">{view.lastError.message}</span>
          </InlineAlert>
        ) : null}
      </div>
    </main>
  );
}

function EvidenceRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--nimi-border-subtle)] pb-2 last:border-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-[var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all font-medium sm:text-right">{value}</dd>
    </div>
  );
}

function BoundaryAlert({ title, evidence }: { readonly title: string; readonly evidence: BoundaryEvidence }) {
  const tone = evidence.state === 'succeeded' || evidence.state === 'rejected'
    ? 'success'
    : evidence.state === 'failed'
      ? 'danger'
      : 'info';
  return (
    <InlineAlert
      tone={tone}
      icon={evidence.state === 'succeeded' || evidence.state === 'rejected'
        ? <CheckCircle2 size={18} aria-hidden="true" />
        : <AlertTriangle size={18} aria-hidden="true" />}
    >
      <strong className="block break-words">{title} · {evidence.reasonCode}</strong>
      <span className="mt-1 block break-words">{evidence.message}</span>
    </InlineAlert>
  );
}

function normalizeJourneyError(error: unknown): JourneyErrorEvidence {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = nonEmptyText(record.reasonCode)
    || nonEmptyText(record.code)
    || (error instanceof Error ? nonEmptyText(error.message) : '')
    || 'local-app-boundary-check-failed';
  return {
    reasonCode,
    actionHint: nonEmptyText(record.actionHint) || 'inspect_local_app_boundary',
    message: error instanceof Error ? nonEmptyText(error.message) || reasonCode : reasonCode,
    retryable: record.retryable === true,
  };
}

function boundaryError(reasonCode: string, actionHint: string): Error {
  return Object.assign(new Error(reasonCode), { reasonCode, actionHint, source: 'renderer' });
}

function statusPresentation(view: JourneyView): {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
} {
  switch (view.state) {
    case 'session-bound': return { label: 'Session bound', tone: 'info' };
    case 'app-private-storage-ready': return { label: 'Private storage ready', tone: 'success' };
    case 'permission-request-rejected': return { label: 'Reserved permission rejected', tone: 'success' };
    case 'runtime-unavailable': return { label: 'Runtime unavailable', tone: 'warning' };
    case 'error': return { label: 'Boundary failure', tone: 'danger' };
    default: return { label: 'Checking', tone: 'neutral' };
  }
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
