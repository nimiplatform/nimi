import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  MessageCircleMore,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { createNimiAppRuntimePlatformClient } from '@nimiplatform/kit/core/sdk-contract';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  NimiText,
  ScrollArea,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import type { ZhiyuSelectedLocalDevelopmentTarget } from '../app/evidence-window';

const OPEN_OPERATION = 'runtime_agent.conversation.open';
const CONVERSATION_OPERATIONS = [
  {
    operationId: 'runtime_agent.conversation.turn_send',
    label: '发送消息',
    purpose: '向这段由 Runtime 持有的会话发送消息',
  },
  {
    operationId: 'runtime_agent.conversation.turn_subscribe',
    label: '接收事件',
    purpose: '读取这段 Runtime 会话产生的实时事件',
  },
  {
    operationId: 'runtime_agent.conversation.snapshot',
    label: '读取会话',
    purpose: '读取这段 Runtime 会话的最新快照',
  },
] as const;
const TERMINAL_EVENTS = new Set([
  'runtime.agent.turn.completed',
  'runtime.agent.turn.failed',
  'runtime.agent.turn.interrupted',
]);
const TURN_EVENT_LIMIT = 256;
const TURN_EVENT_TIMEOUT_MS = 120_000;

type JourneyState =
  | 'loading'
  | 'session-bound-zero-grant'
  | 'open-denied'
  | 'open-grant-pending'
  | 'open-granted'
  | 'conversation-open'
  | 'conversation-grants-pending'
  | 'ready'
  | 'sending'
  | 'completed'
  | 'runtime-unavailable'
  | 'access-lost'
  | 'error';

type PermissionEvidence = {
  readonly state: string;
  readonly reasonCode: string;
  readonly actionHint: string;
};

type JourneyErrorEvidence = {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
  readonly retryable: boolean;
};

type TranscriptEvidence = {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly status: string;
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
  readonly openPermission: PermissionEvidence | null;
  readonly conversationPermissions: Readonly<Record<string, PermissionEvidence>>;
  readonly conversationAnchorId: string;
  readonly threadId: string;
  readonly cursor: string;
  readonly eventNames: readonly string[];
  readonly transcript: readonly TranscriptEvidence[];
  readonly lastError: JourneyErrorEvidence | null;
};

type JourneyView = ZhiyuDevKernelEvidence & {
  readonly busyAction: string;
};

const INITIAL_VIEW: Omit<JourneyView, 'agentId' | 'buildMarker'> = {
  profile: 'isolated-local-development',
  state: 'loading',
  session: null,
  openPermission: null,
  conversationPermissions: {},
  conversationAnchorId: '',
  threadId: '',
  cursor: '',
  eventNames: [],
  transcript: [],
  lastError: null,
  busyAction: '正在连接固定 Runtime 服务',
};

export function ZhiyuLocalDevelopmentJourney({
  target,
}: {
  readonly target: ZhiyuSelectedLocalDevelopmentTarget;
}) {
  const platform = useMemo(() => createNimiAppRuntimePlatformClient({
    standardShell: createNimiLocalAppStandardShellSurface(),
  }), []);
  const [view, setView] = useState<JourneyView>(() => ({
    ...INITIAL_VIEW,
    agentId: target.agentId,
    buildMarker: target.buildMarker,
  }));
  const [draft, setDraft] = useState('请用一句简短的中文确认：固定 Runtime 服务中的对话已经连通。');
  const openResourceRef = `agent:${target.agentId}`;
  const conversationResourceRef = view.conversationAnchorId
    ? `agent:${target.agentId}/conversation:${view.conversationAnchorId}`
    : '';

  const publishError = useCallback((error: unknown) => {
    const normalized = normalizeJourneyError(error);
    setView((current) => ({
      ...current,
      state: stateForError(normalized.reasonCode),
      busyAction: '',
      lastError: normalized,
    }));
  }, []);

  const refresh = useCallback(async () => {
    setView((current) => ({ ...current, busyAction: '正在刷新 Runtime 与授权状态', lastError: null }));
    try {
      const session = await platform.auth.status();
      const openPermission = await platform.permissions.posture({
        operationId: OPEN_OPERATION,
        resourceRef: openResourceRef,
      });
      const currentAnchorId = view.conversationAnchorId;
      const conversationPermissions: Record<string, PermissionEvidence> = {};
      if (currentAnchorId) {
        const resourceRef = `agent:${target.agentId}/conversation:${currentAnchorId}`;
        const postures = await Promise.all(CONVERSATION_OPERATIONS.map(async (operation) => platform.permissions.posture({
          operationId: operation.operationId,
          resourceRef,
        })));
        for (const posture of postures) {
          conversationPermissions[posture.operationId] = permissionEvidence(posture);
        }
      }
      setView((current) => ({
        ...current,
        session: {
          state: session.state,
          sessionBound: session.sessionBound,
          reasonCode: session.reasonCode,
          retryable: session.retryable,
        },
        openPermission: permissionEvidence(openPermission),
        conversationPermissions,
        state: deriveJourneyState({
          sessionState: session.state,
          openState: openPermission.state,
          hasAnchor: Boolean(currentAnchorId),
          conversationStates: Object.values(conversationPermissions).map((permission) => permission.state),
          hasTranscript: current.transcript.length > 0,
        }),
        busyAction: '',
        lastError: null,
      }));
    } catch (error) {
      publishError(error);
    }
  }, [openResourceRef, platform, publishError, target.agentId, view.conversationAnchorId]);

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

  const attemptOpenConversation = useCallback(async () => {
    setView((current) => ({ ...current, busyAction: '正在请求打开 Runtime 会话', lastError: null }));
    try {
      const snapshot = await platform.agent.openConversation({
        agentId: target.agentId,
        requestedAnchorDisposition: 'create-or-resume',
      });
      const conversationAnchorId = snapshot.anchor?.conversationAnchorId?.trim() || '';
      if (!conversationAnchorId) {
        throw journeyError('conversation-anchor-missing', 'inspect_runtime_agent_anchor', false);
      }
      setView((current) => ({
        ...current,
        state: 'conversation-open',
        conversationAnchorId,
        busyAction: '',
        lastError: null,
      }));
    } catch (error) {
      const normalized = normalizeJourneyError(error);
      setView((current) => ({
        ...current,
        state: normalized.reasonCode === 'no-grant' ? 'open-denied' : stateForError(normalized.reasonCode),
        busyAction: '',
        lastError: normalized,
      }));
    }
  }, [platform, target.agentId]);

  const requestOpenGrant = useCallback(async () => {
    setView((current) => ({ ...current, busyAction: '正在向 Desktop 提交打开会话权限', lastError: null }));
    try {
      const posture = await platform.permissions.request({
        operationId: OPEN_OPERATION,
        resourceRef: openResourceRef,
        purpose: '打开或恢复这个由 Runtime 持有的开发联调会话',
      });
      setView((current) => ({
        ...current,
        state: 'open-grant-pending',
        openPermission: permissionEvidence(posture),
        busyAction: '',
      }));
    } catch (error) {
      publishError(error);
    }
  }, [openResourceRef, platform, publishError]);

  const requestConversationGrants = useCallback(async () => {
    if (!conversationResourceRef) {
      publishError(journeyError('conversation-anchor-missing', 'open_runtime_agent_conversation', false));
      return;
    }
    setView((current) => ({ ...current, busyAction: '正在向 Desktop 提交三项会话权限', lastError: null }));
    try {
      const permissions: Record<string, PermissionEvidence> = {};
      for (const operation of CONVERSATION_OPERATIONS) {
        const current = await platform.permissions.posture({
          operationId: operation.operationId,
          resourceRef: conversationResourceRef,
        });
        const posture = current.state === 'zero-grant' || current.state === 'denied'
          ? await platform.permissions.request({
              operationId: operation.operationId,
              resourceRef: conversationResourceRef,
              purpose: operation.purpose,
            })
          : current;
        permissions[operation.operationId] = permissionEvidence(posture);
      }
      setView((current) => ({
        ...current,
        state: 'conversation-grants-pending',
        conversationPermissions: permissions,
        busyAction: '',
      }));
    } catch (error) {
      publishError(error);
    }
  }, [conversationResourceRef, platform, publishError]);

  const sendTurn = useCallback(async () => {
    const userText = draft.trim();
    const conversationAnchorId = view.conversationAnchorId;
    if (!userText || !conversationAnchorId) {
      publishError(journeyError('turn-input-required', 'enter_message_and_open_conversation', false));
      return;
    }
    setView((current) => ({
      ...current,
      state: 'sending',
      busyAction: 'RuntimeAgent 正在回复',
      eventNames: [],
      cursor: '',
      lastError: null,
    }));
    try {
      let cursor: string | undefined;
      let nextPage = withTimeout(platform.agent.subscribeTurn({
        agentId: target.agentId,
        conversationAnchorId,
        cursor,
      }), TURN_EVENT_TIMEOUT_MS, 'turn-event-timeout');
      await platform.agent.sendTurn({
        agentId: target.agentId,
        conversationAnchorId,
        clientTurnId: `zhiyu-dev-${crypto.randomUUID()}`,
        userText,
      });
      let terminalEvent = '';
      for (let index = 0; index < TURN_EVENT_LIMIT; index += 1) {
        const page = await nextPage;
        cursor = page.cursor;
        const eventName = page.events[0].eventName;
        setView((current) => ({
          ...current,
          cursor: page.cursor,
          eventNames: [...current.eventNames, eventName],
        }));
        if (TERMINAL_EVENTS.has(eventName)) {
          terminalEvent = eventName;
          break;
        }
        nextPage = withTimeout(platform.agent.subscribeTurn({
          agentId: target.agentId,
          conversationAnchorId,
          cursor,
        }), TURN_EVENT_TIMEOUT_MS, 'turn-event-timeout');
      }
      if (!terminalEvent) {
        throw journeyError('turn-event-limit-exceeded', 'inspect_runtime_agent_event_stream', false);
      }
      const snapshot = await platform.agent.getConversationSnapshot({
        agentId: target.agentId,
        conversationAnchorId,
      });
      const transcript = (snapshot.transcript || []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
      }));
      if (terminalEvent !== 'runtime.agent.turn.completed') {
        throw journeyError(terminalEvent, 'inspect_runtime_agent_terminal_event', false);
      }
      setView((current) => ({
        ...current,
        state: 'completed',
        threadId: snapshot.threadId || '',
        transcript,
        busyAction: '',
        lastError: null,
      }));
      setDraft('');
    } catch (error) {
      publishError(error);
    }
  }, [draft, platform, publishError, target.agentId, view.conversationAnchorId]);

  const busy = Boolean(view.busyAction);
  const conversationGranted = CONVERSATION_OPERATIONS.every(
    (operation) => view.conversationPermissions[operation.operationId]?.state === 'granted',
  );
  const canSend = Boolean(view.conversationAnchorId) && conversationGranted && !busy;
  const status = statusPresentation(view);

  return (
    <main
      className="min-h-screen min-w-0 overflow-x-hidden bg-[var(--nimi-surface-canvas)] px-4 py-5 text-[var(--nimi-text-primary)] sm:px-7 sm:py-7"
      data-testid="zhiyu-dev-kernel-root"
    >
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5">
        <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone="info" shape="dot">隔离的 local_development build</StatusBadge>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </div>
            <NimiText role="page-title">知语 · 开发内核联调</NimiText>
            <NimiText role="body" className="mt-2 max-w-3xl">
              这不是已随产品发布的知语。它通过 Desktop 监督的受保护载体，连接固定 Windows Runtime 服务。
            </NimiText>
          </div>
          <Button
            tone="secondary"
            size="sm"
            leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
            loading={view.busyAction.includes('刷新')}
            onClick={() => void refresh()}
            data-testid="zhiyu-dev-kernel-refresh"
          >
            刷新真实状态
          </Button>
        </header>

        <InlineAlert
          tone="warning"
          icon={<AlertTriangle size={18} aria-hidden="true" />}
        >
          <strong className="font-semibold">原生 Windows 风险提示：</strong>
          这个进程是本机开发代码，能够使用当前 Windows 用户自身已有的系统权限。Nimi 权限只约束 Nimi API，不能把原生进程变成沙箱。
        </InlineAlert>

        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Surface tone="panel" elevation="raised" padding="lg" className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]">
                <ShieldCheck size={21} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <NimiText role="card-title">固定服务会话</NimiText>
                <p className="mt-1 break-all text-xs text-[var(--nimi-text-muted)]" data-testid="zhiyu-dev-kernel-agent-id">
                  {target.agentId}
                </p>
              </div>
            </div>

            {view.state === 'loading' ? (
              <LoadingSkeleton className="mt-6" lines={4} data-testid="zhiyu-dev-kernel-loading" />
            ) : (
              <dl className="mt-6 grid min-w-0 gap-3 text-sm" data-testid="zhiyu-dev-kernel-status">
                <StatusRow label="Session" value={view.session?.state || '未连接'} />
                <StatusRow label="打开会话" value={view.openPermission?.state || '未检查'} />
                <StatusRow label="会话锚点" value={view.conversationAnchorId || '尚未创建'} breakAll />
                <StatusRow label="Build marker" value={target.buildMarker} breakAll />
                <StatusRow label="事件游标" value={view.cursor || '尚无事件'} />
              </dl>
            )}

            <div className="mt-6 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                tone={view.openPermission?.state === 'granted' ? 'primary' : 'secondary'}
                leadingIcon={<MessageCircleMore size={17} aria-hidden="true" />}
                loading={view.busyAction.includes('打开 Runtime 会话')}
                disabled={busy && !view.busyAction.includes('打开 Runtime 会话')}
                onClick={() => void attemptOpenConversation()}
                data-testid="zhiyu-dev-kernel-attempt-open"
                className="w-full sm:w-auto"
              >
                {view.conversationAnchorId ? '重新打开或恢复' : '尝试打开会话'}
              </Button>
              <Button
                tone="secondary"
                leadingIcon={<KeyRound size={17} aria-hidden="true" />}
                loading={view.busyAction.includes('打开会话权限')}
                disabled={busy || view.openPermission?.state === 'granted' || view.openPermission?.state === 'pending'}
                onClick={() => void requestOpenGrant()}
                data-testid="zhiyu-dev-kernel-request-open-grant"
                className="w-full sm:w-auto"
              >
                请求打开权限
              </Button>
            </div>
          </Surface>

          <Surface tone="card" elevation="raised" padding="lg" className="min-w-0">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <NimiText role="card-title">RuntimeAgent 会话能力</NimiText>
                <NimiText role="helper" className="mt-1">
                  打开、发送、事件订阅与快照由 Desktop 逐项授权；全局 Developer Mode 本身不授予任何能力。
                </NimiText>
              </div>
              <StatusBadge tone={conversationGranted ? 'success' : 'neutral'}>
                {conversationGranted ? '3 / 3 已授权' : `${Object.values(view.conversationPermissions).filter((permission) => permission.state === 'granted').length} / 3 已授权`}
              </StatusBadge>
            </div>
            <ul className="mt-5 grid min-w-0 gap-2" aria-label="RuntimeAgent 会话权限">
              {CONVERSATION_OPERATIONS.map((operation) => {
                const permission = view.conversationPermissions[operation.operationId];
                return (
                  <li key={operation.operationId} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{operation.label}</span>
                      <span className="block break-all text-xs text-[var(--nimi-text-muted)]">{operation.operationId}</span>
                    </span>
                    <StatusBadge tone={permission?.state === 'granted' ? 'success' : permission?.state === 'pending' ? 'warning' : 'neutral'}>
                      {permission?.state || '未检查'}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
            <Button
              tone="secondary"
              leadingIcon={<KeyRound size={17} aria-hidden="true" />}
              loading={view.busyAction.includes('三项会话权限')}
              disabled={busy || !view.conversationAnchorId || conversationGranted}
              onClick={() => void requestConversationGrants()}
              data-testid="zhiyu-dev-kernel-request-conversation-grants"
              className="mt-4 w-full sm:w-auto"
            >
              请求三项会话权限
            </Button>
          </Surface>
        </section>

        {view.lastError ? (
          <InlineAlert
            tone={view.state === 'open-denied' ? 'warning' : 'danger'}
            icon={<AlertTriangle size={18} aria-hidden="true" />}
            data-testid="zhiyu-dev-kernel-error"
          >
            <div className="min-w-0">
              <strong className="block break-all font-semibold">{view.lastError.reasonCode}</strong>
              <span className="mt-1 block break-words">{errorMessage(view.lastError)}</span>
              <span className="mt-1 block break-all text-xs opacity-80">下一步：{view.lastError.actionHint}</span>
            </div>
          </InlineAlert>
        ) : null}

        {view.busyAction ? (
          <InlineAlert tone="info" icon={<RotateCcw className="animate-spin" size={17} aria-hidden="true" />}>
            <span data-testid="zhiyu-dev-kernel-busy">{view.busyAction}</span>
          </InlineAlert>
        ) : null}

        <Surface tone="panel" elevation="raised" padding="none" className="min-w-0 overflow-hidden">
          <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <MessageCircleMore size={19} aria-hidden="true" />
              <NimiText role="section-title">真实对话</NimiText>
            </div>
            <NimiText role="helper" className="mt-1">
              对话与 Agent 所有权仍属于 Runtime account；此开发 app 只是经授权的调用与审计主体。
            </NimiText>
          </div>
          <ScrollArea
            className="h-[min(38vh,22rem)] min-h-56"
            viewportClassName="px-4 py-4 sm:px-6"
            contentClassName="flex min-w-0 flex-col gap-3"
          >
            {view.transcript.length === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center px-3 text-center" data-testid="zhiyu-dev-kernel-transcript">
                <MessageCircleMore size={28} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
                <NimiText role="body" className="mt-3">完成逐项授权后，第一条真实 RuntimeAgent 对话会显示在这里。</NimiText>
              </div>
            ) : (
              <div className="contents" data-testid="zhiyu-dev-kernel-transcript">
                {view.transcript.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[92%] min-w-0 rounded-[var(--nimi-radius-md)] px-4 py-3 ${message.role === 'user' ? 'ml-auto bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'mr-auto border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'}`}
                  >
                    <span className="block text-xs font-semibold opacity-75">{message.role === 'user' ? '你' : '知语'}</span>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                  </article>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="border-t border-[var(--nimi-border-subtle)] p-4 sm:p-6">
            <label htmlFor="zhiyu-dev-kernel-composer" className="mb-2 block text-sm font-medium">
              发送给固定服务中的 RuntimeAgent
            </label>
            <TextareaField
              id="zhiyu-dev-kernel-composer"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSend) {
                  event.preventDefault();
                  void sendTurn();
                }
              }}
              disabled={!view.conversationAnchorId || busy}
              placeholder="输入一条中文消息…"
              aria-describedby="zhiyu-dev-kernel-composer-help"
              data-testid="zhiyu-dev-kernel-composer"
              textareaClassName="min-h-24 max-h-52"
            />
            <div className="mt-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <NimiText id="zhiyu-dev-kernel-composer-help" role="helper">
                Ctrl / ⌘ + Enter 发送。若 Runtime 重启、account 切换或授权被撤销，下一次操作会明确拒绝。
              </NimiText>
              <Button
                tone="primary"
                leadingIcon={view.state === 'completed' ? <CheckCircle2 size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
                loading={view.state === 'sending'}
                disabled={!canSend || !draft.trim()}
                onClick={() => void sendTurn()}
                data-testid="zhiyu-dev-kernel-send"
                className="w-full sm:w-auto"
              >
                发送真实消息
              </Button>
            </div>
          </div>
        </Surface>
      </div>
    </main>
  );
}

function StatusRow({ label, value, breakAll = false }: { readonly label: string; readonly value: string; readonly breakAll?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-[var(--nimi-border-subtle)] pb-2 last:border-0 last:pb-0">
      <dt className="text-[var(--nimi-text-muted)]">{label}</dt>
      <dd className={`min-w-0 text-right font-medium ${breakAll ? 'break-all' : 'break-words'}`}>{value}</dd>
    </div>
  );
}

function permissionEvidence(value: { readonly state: string; readonly reasonCode: string; readonly actionHint: string }): PermissionEvidence {
  return { state: value.state, reasonCode: value.reasonCode, actionHint: value.actionHint };
}

function deriveJourneyState(input: {
  readonly sessionState: string;
  readonly openState: string;
  readonly hasAnchor: boolean;
  readonly conversationStates: readonly string[];
  readonly hasTranscript: boolean;
}): JourneyState {
  if (input.sessionState === 'unavailable') return 'runtime-unavailable';
  if (['revoked', 'account-changed', 'process-replaced', 'project-changed'].includes(input.sessionState)) return 'access-lost';
  if (input.hasAnchor && input.conversationStates.length === CONVERSATION_OPERATIONS.length) {
    if (input.conversationStates.every((state) => state === 'granted')) {
      return input.hasTranscript ? 'completed' : 'ready';
    }
    if (input.conversationStates.some((state) => state === 'pending')) return 'conversation-grants-pending';
    return 'conversation-open';
  }
  if (input.hasAnchor) return 'conversation-open';
  if (input.openState === 'granted') return 'open-granted';
  if (input.openState === 'pending') return 'open-grant-pending';
  return 'session-bound-zero-grant';
}

function normalizeJourneyError(error: unknown): JourneyErrorEvidence {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = nonEmptyText(record.reasonCode)
    || nonEmptyText(record.code)
    || (error instanceof Error ? nonEmptyText(error.message) : '')
    || 'local-app-operation-failed';
  return {
    reasonCode,
    actionHint: nonEmptyText(record.actionHint) || 'refresh_runtime_and_permission_state',
    message: error instanceof Error ? nonEmptyText(error.message) || reasonCode : reasonCode,
    retryable: typeof record.retryable === 'boolean' ? record.retryable : false,
  };
}

function journeyError(reasonCode: string, actionHint: string, retryable: boolean): Error {
  return Object.assign(new Error(reasonCode), { reasonCode, actionHint, retryable });
}

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stateForError(reasonCode: string): JourneyState {
  if (reasonCode === 'runtime-service-unavailable' || reasonCode === 'runtime-restarted') return 'runtime-unavailable';
  if (['revoked', 'grant-revoked', 'grant-superseded', 'presence-expired', 'account-changed', 'process-replaced', 'project-changed'].includes(reasonCode)) return 'access-lost';
  return 'error';
}

function errorMessage(error: JourneyErrorEvidence): string {
  switch (error.reasonCode) {
    case 'no-grant': return '已验证零授权 session：当前操作被 Runtime 拒绝。请从 Desktop 明确授予这一项能力。';
    case 'runtime-service-unavailable': return '固定 Windows Runtime 服务当前不可用。启动或修复服务后再刷新。';
    case 'runtime-restarted': return 'Runtime 已重启，旧 session 已失效。刷新后会通过受保护载体重新建链。';
    case 'account-changed': return 'Desktop account 已切换，旧 account 下的 session 与 grant 不会继承。';
    case 'revoked':
    case 'grant-revoked': return 'Desktop 已撤销访问。后续操作被拒绝，必须重新申请。';
    case 'grant-superseded': return '这项授权已被更新版本替代。刷新权限状态后重新申请。';
    case 'presence-expired': return '授权所需的在场验证已过期。请返回 Desktop 重新验证。';
    case 'process-replaced': return '开发进程已替换，旧 lease/session 不能继续使用。请等待 Desktop 监督的新进程。';
    default: return error.message;
  }
}

function statusPresentation(view: JourneyView): { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' } {
  switch (view.state) {
    case 'completed': return { label: '真实对话已完成', tone: 'success' };
    case 'ready': return { label: '已授权，可发送', tone: 'success' };
    case 'sending': return { label: 'RuntimeAgent 处理中', tone: 'info' };
    case 'open-grant-pending':
    case 'conversation-grants-pending': return { label: '等待 Desktop 批准', tone: 'warning' };
    case 'runtime-unavailable': return { label: 'Runtime 不可用', tone: 'danger' };
    case 'access-lost': return { label: '访问已失效', tone: 'danger' };
    case 'open-denied': return { label: '零授权拒绝已验证', tone: 'warning' };
    case 'error': return { label: '操作失败', tone: 'danger' };
    case 'loading': return { label: '正在连接', tone: 'info' };
    default: return { label: '零授权 session', tone: 'neutral' };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reasonCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(journeyError(reasonCode, 'inspect_runtime_agent_event_stream', true));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
