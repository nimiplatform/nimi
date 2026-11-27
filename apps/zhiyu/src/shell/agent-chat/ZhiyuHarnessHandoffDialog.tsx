import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, Clock, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nimiplatform/kit/ui';
import {
  buildEditableHandoffBriefDraft,
  composeHandoffBriefPayload,
  formatHandoffBriefPreview,
  MAX_HANDOFF_BRIEF_CHARS,
  NAMED_HARNESS_APP_ID,
  NAMED_HARNESS_DISPLAY_NAME,
  submitZhiyuHarnessHandoff,
  type ZhiyuHandoffBriefPoint,
  type ZhiyuHandoffSubmitPayload,
  type ZhiyuHandoffSubmitResult,
} from './zhiyu-harness-handoff';

const EMPTY_TOPIC_HINTS: readonly string[] = [];

export type ZhiyuHarnessHandoffDialogProps = {
  readonly open: boolean;
  readonly accountScopeKey?: string | null;
  readonly partnerName: string;
  readonly agentHandle: string | null;
  readonly currentDraft: string;
  readonly recentTopicHints?: readonly string[];
  readonly onClose: () => void;
};

type RecordedHandoffSubmission = {
  readonly payload: ZhiyuHandoffSubmitPayload;
  readonly receipt: ZhiyuHandoffSubmitResult;
  readonly seenWhileOpen?: boolean;
};

type ActiveHandoffRequest = {
  readonly payload: ZhiyuHandoffSubmitPayload;
  readonly seq: number;
};

type UnconfirmedHandoffAttempt = {
  readonly payload: ZhiyuHandoffSubmitPayload;
};

type HandoffScopeState = {
  initialized: boolean;
  goal: string;
  points: readonly ZhiyuHandoffBriefPoint[];
  extraNotes: string;
  stayedNotice: string;
  hasDraftEdits: boolean;
  reconfirmed: boolean;
  error: string | null;
  rejectedOutcome: 'AMBIGUOUS_CANDIDATES' | null;
  latestSubmittedSeq: number;
  activeRequest: ActiveHandoffRequest | null;
  inFlightSubmission: RecordedHandoffSubmission | null;
  acceptedSubmission: RecordedHandoffSubmission | null;
  unconfirmedAttempt: UnconfirmedHandoffAttempt | null;
  dialogOpen: boolean;
};

type HandoffScopeEntry = {
  state: HandoffScopeState;
  readonly listeners: Set<() => void>;
};

const handoffScopes = new Map<string, HandoffScopeEntry>();

function resolveScopeKey(accountScopeKey: string | null | undefined, agentHandle: string | null): string {
  const account = (accountScopeKey ?? '').trim() || '__default_account__';
  const partner = (agentHandle ?? '').trim() || '__no_partner__';
  return `${account}::${partner}`;
}

function createEmptyScopeState(): HandoffScopeState {
  return {
    initialized: false,
    goal: '',
    points: [],
    extraNotes: '',
    stayedNotice: '',
    hasDraftEdits: false,
    reconfirmed: false,
    error: null,
    rejectedOutcome: null,
    latestSubmittedSeq: 0,
    activeRequest: null,
    inFlightSubmission: null,
    acceptedSubmission: null,
    unconfirmedAttempt: null,
    dialogOpen: false,
  };
}

function getOrCreateScopeEntry(scopeKey: string): HandoffScopeEntry {
  let entry = handoffScopes.get(scopeKey);
  if (!entry) {
    entry = {
      state: createEmptyScopeState(),
      listeners: new Set(),
    };
    handoffScopes.set(scopeKey, entry);
  }
  return entry;
}

function shouldRetainScopeEntry(entry: HandoffScopeEntry): boolean {
  return (
    entry.listeners.size > 0
    || entry.state.dialogOpen
    || shouldPreserveScopeOnOpen(entry.state)
  );
}

function pruneScopeIfIdle(scopeKey: string): void {
  const entry = handoffScopes.get(scopeKey);
  if (entry && !shouldRetainScopeEntry(entry)) {
    handoffScopes.delete(scopeKey);
  }
}

function updateScopeState(scopeKey: string, updater: (prev: HandoffScopeState) => HandoffScopeState): void {
  const entry = getOrCreateScopeEntry(scopeKey);
  const next = updater(entry.state);
  if (next === entry.state) {
    pruneScopeIfIdle(scopeKey);
    return;
  }
  entry.state = next;
  for (const listener of entry.listeners) {
    listener();
  }
  pruneScopeIfIdle(scopeKey);
}

export function resetZhiyuHarnessHandoffScopesForTests(): void {
  handoffScopes.clear();
}

export function getZhiyuHarnessHandoffScopeCountForTests(): number {
  return handoffScopes.size;
}

function buildSeededDraftFields(input: {
  readonly partnerName: string;
  readonly currentDraft: string;
  readonly recentTopicHints: readonly string[];
}): Pick<HandoffScopeState, 'initialized' | 'goal' | 'points' | 'extraNotes' | 'stayedNotice'> {
  const draft = buildEditableHandoffBriefDraft(input);
  return {
    initialized: true,
    goal: draft.goal,
    points: draft.points,
    extraNotes: draft.extraNotes,
    stayedNotice: draft.stayedInZhiyuNotice,
  };
}

function shouldPreserveScopeOnOpen(state: HandoffScopeState): boolean {
  if (!state.initialized) return false;
  return (
    state.activeRequest !== null
    || state.inFlightSubmission !== null
    || state.unconfirmedAttempt !== null
    || state.error !== null
    || state.hasDraftEdits
    || Boolean(state.acceptedSubmission && state.acceptedSubmission.seenWhileOpen === false)
  );
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.harness-brief-handoff
export function ZhiyuHarnessHandoffDialog({
  open,
  accountScopeKey = null,
  partnerName,
  agentHandle,
  currentDraft,
  recentTopicHints = EMPTY_TOPIC_HINTS,
  onClose,
}: ZhiyuHarnessHandoffDialogProps) {
  const scopeKey = resolveScopeKey(accountScopeKey, agentHandle);
  const [, setTick] = useState(0);
  const seedInputsRef = useRef({ partnerName, currentDraft, recentTopicHints });
  seedInputsRef.current = { partnerName, currentDraft, recentTopicHints };

  useEffect(() => {
    if (!open) return;
    const entry = getOrCreateScopeEntry(scopeKey);
    const notify = () => setTick((t) => t + 1);
    entry.listeners.add(notify);
    return () => {
      entry.listeners.delete(notify);
      pruneScopeIfIdle(scopeKey);
    };
  }, [open, scopeKey]);

  useEffect(() => {
    if (!open) {
      if (handoffScopes.has(scopeKey)) {
        updateScopeState(scopeKey, (prev) => (prev.dialogOpen ? { ...prev, dialogOpen: false } : prev));
      }
      return;
    }
    const seedInputs = seedInputsRef.current;
    updateScopeState(scopeKey, (prev) => {
      if (prev.dialogOpen && prev.initialized) {
        return prev;
      }
      if (!shouldPreserveScopeOnOpen(prev)) {
        return {
          ...prev,
          ...buildSeededDraftFields(seedInputs),
          hasDraftEdits: false,
          reconfirmed: false,
          error: null,
          rejectedOutcome: null,
          acceptedSubmission: null,
          unconfirmedAttempt: null,
          dialogOpen: true,
        };
      }
      const nextAccepted = prev.acceptedSubmission && prev.acceptedSubmission.seenWhileOpen === false
        ? { ...prev.acceptedSubmission, seenWhileOpen: true }
        : prev.acceptedSubmission;
      return {
        ...prev,
        acceptedSubmission: nextAccepted,
        dialogOpen: true,
      };
    });
    return () => {
      if (handoffScopes.has(scopeKey)) {
        updateScopeState(scopeKey, (prev) => (prev.dialogOpen ? { ...prev, dialogOpen: false } : prev));
      }
    };
  }, [open, scopeKey]);

  const scopeState = handoffScopes.get(scopeKey)?.state ?? createEmptyScopeState();

  const {
    goal,
    points,
    extraNotes,
    stayedNotice,
    hasDraftEdits,
    reconfirmed,
    error,
    rejectedOutcome,
    activeRequest,
    inFlightSubmission,
    acceptedSubmission,
    unconfirmedAttempt,
  } = scopeState;

  const resetFreshDraft = () => {
    updateScopeState(scopeKey, (prev) => ({
      ...prev,
      ...buildSeededDraftFields({ partnerName, currentDraft, recentTopicHints }),
      hasDraftEdits: false,
      reconfirmed: false,
      error: null,
      rejectedOutcome: null,
      acceptedSubmission: null,
      unconfirmedAttempt: null,
    }));
  };

  const updateDraft = (
    nextGoal: string,
    nextPoints: readonly ZhiyuHandoffBriefPoint[],
    nextNotes: string,
  ) => {
    // Draft edits only affect the next selectable action; keep any submitted
    // unconfirmedAttempt bound to its original payload/requestId so temporary
    // edits reverted back to the submitted version still reuse the original ID.
    updateScopeState(scopeKey, (prev) => ({
      ...prev,
      goal: nextGoal,
      points: nextPoints,
      extraNotes: nextNotes,
      hasDraftEdits: true,
      reconfirmed: false,
      rejectedOutcome: null,
    }));
  };

  const togglePoint = (id: string) => {
    const nextPoints = points.map((pt) => (pt.id === id ? { ...pt, selected: !pt.selected } : pt));
    updateDraft(goal, nextPoints, extraNotes);
  };

  const updatePointText = (id: string, text: string) => {
    const nextPoints = points.map((pt) => (pt.id === id ? { ...pt, text } : pt));
    updateDraft(goal, nextPoints, extraNotes);
  };

  const removePoint = (id: string) => {
    const nextPoints = points.filter((pt) => pt.id !== id);
    updateDraft(goal, nextPoints, extraNotes);
  };

  const briefPreview = formatHandoffBriefPreview({ goal, points, extraNotes });
  const overBudget = briefPreview.length > MAX_HANDOFF_BRIEF_CHARS;
  const isSameAsActive = Boolean(activeRequest && briefPreview === activeRequest.payload.handoffBriefText);
  const isSameAsInFlight = Boolean(inFlightSubmission && briefPreview === inFlightSubmission.payload.handoffBriefText);
  const isSameAsAccepted = Boolean(acceptedSubmission && briefPreview === acceptedSubmission.payload.handoffBriefText);
  const isSameAsUnconfirmed = Boolean(
    unconfirmedAttempt && briefPreview === unconfirmedAttempt.payload.handoffBriefText,
  );
  const requiresReconfirmForNewSend = Boolean(
    (activeRequest || inFlightSubmission || acceptedSubmission || unconfirmedAttempt)
    && briefPreview
    && !isSameAsActive
    && !isSameAsInFlight
    && !isSameAsAccepted
    && !isSameAsUnconfirmed,
  );
  const activeReceipt = acceptedSubmission?.receipt ?? inFlightSubmission?.receipt ?? null;

  const handleSubmit = async () => {
    // Reuse requestId strictly for idempotent retries of the exact same
    // unconfirmed attempt or already-queued version; mint a brand-new
    // requestId only when the user confirms a different version or starts a
    // fresh task.
    const reusedRequestId = isSameAsUnconfirmed
      ? unconfirmedAttempt?.payload.requestId
      : isSameAsInFlight
        ? inFlightSubmission?.payload.requestId
        : undefined;
    let payload: ZhiyuHandoffSubmitPayload;
    try {
      payload = composeHandoffBriefPayload({
        agentHandle: agentHandle ?? '',
        goal,
        points,
        extraNotes,
        requestId: reusedRequestId,
      });
    } catch (err) {
      const base = err instanceof Error ? err.message : `交给 ${NAMED_HARNESS_DISPLAY_NAME} (${NAMED_HARNESS_APP_ID}) 失败`;
      updateScopeState(scopeKey, (prev) => ({
        ...prev,
        error: base,
      }));
      return;
    }

    let submitSeq = 0;
    updateScopeState(scopeKey, (prev) => {
      submitSeq = prev.latestSubmittedSeq + 1;
      return {
        ...prev,
        error: null,
        rejectedOutcome: null,
        latestSubmittedSeq: submitSeq,
        activeRequest: { payload, seq: submitSeq },
        unconfirmedAttempt: null,
      };
    });

    try {
      const res = await submitZhiyuHarnessHandoff(payload);
      // Settle strictly into the originating (account, partner) scope — even if
      // the dialog closed or the user switched partners before the receipt
      // returned — and never overwrite state belonging to a newer submission.
      updateScopeState(scopeKey, (prev) => {
        const isCurrentActive = prev.activeRequest?.seq === submitSeq;
        if (submitSeq !== prev.latestSubmittedSeq) {
          return isCurrentActive ? { ...prev, activeRequest: null } : prev;
        }
        const currentDraftPreview = formatHandoffBriefPreview({
          goal: prev.goal,
          points: prev.points,
          extraNotes: prev.extraNotes,
        });
        const draftMatchesSubmitted = currentDraftPreview === payload.handoffBriefText;
        if (res.outcome === 'ACCEPTED') {
          return {
            ...prev,
            activeRequest: null,
            acceptedSubmission: { payload, receipt: res, seenWhileOpen: prev.dialogOpen },
            inFlightSubmission: prev.inFlightSubmission && prev.inFlightSubmission.payload.requestId === payload.requestId
              ? null
              : prev.inFlightSubmission,
            unconfirmedAttempt: null,
            error: null,
            rejectedOutcome: null,
            hasDraftEdits: draftMatchesSubmitted ? false : prev.hasDraftEdits,
            reconfirmed: false,
          };
        }
        if (res.outcome === 'DEFERRED_BODY_OFFLINE') {
          return {
            ...prev,
            activeRequest: null,
            inFlightSubmission: { payload, receipt: res, seenWhileOpen: prev.dialogOpen },
            acceptedSubmission: null,
            unconfirmedAttempt: null,
            error: null,
            rejectedOutcome: null,
            reconfirmed: false,
          };
        }
        if (res.outcome === 'AMBIGUOUS_CANDIDATES') {
          return {
            ...prev,
            activeRequest: null,
            unconfirmedAttempt: null,
            rejectedOutcome: 'AMBIGUOUS_CANDIDATES',
            error: `存在多个可继续的本机任务候选，草稿已保留，请补充更明确的任务目标后重新交给 ${NAMED_HARNESS_DISPLAY_NAME} (${NAMED_HARNESS_APP_ID})。`,
          };
        }
        return {
          ...prev,
          activeRequest: null,
          unconfirmedAttempt: { payload },
          rejectedOutcome: null,
          error: `未能确认简报已被 ${NAMED_HARNESS_DISPLAY_NAME} (${NAMED_HARNESS_APP_ID}) 受理，草稿已保留。直接重试将沿用同一请求编号避免重复投递；若需改稿请编辑后重新提交。`,
        };
      });
    } catch (err) {
      const base = err instanceof Error ? err.message : `交给 ${NAMED_HARNESS_DISPLAY_NAME} (${NAMED_HARNESS_APP_ID}) 失败`;
      updateScopeState(scopeKey, (prev) => {
        const isCurrentActive = prev.activeRequest?.seq === submitSeq;
        if (submitSeq !== prev.latestSubmittedSeq) {
          return isCurrentActive ? { ...prev, activeRequest: null } : prev;
        }
        return {
          ...prev,
          activeRequest: null,
          unconfirmedAttempt: { payload },
          rejectedOutcome: null,
          error: `${base}（草稿已保留；不改内容直接重试将沿用同一请求编号避免重复投递）`,
        };
      });
    }
  };

  const submitDisabled = isSameAsActive
    || !agentHandle
    || overBudget
    || !briefPreview
    || isSameAsAccepted
    || (requiresReconfirmForNewSend && !reconfirmed);

  const submitLabel = isSameAsActive
    ? '正在提交…'
    : isSameAsUnconfirmed
      ? `重试同一版本（交给 ${NAMED_HARNESS_DISPLAY_NAME}）`
      : isSameAsInFlight
        ? `重检同一版本状态（不重复投递）`
        : requiresReconfirmForNewSend
          ? `重新确认并新发给 ${NAMED_HARNESS_DISPLAY_NAME}`
          : `确认交给 ${NAMED_HARNESS_DISPLAY_NAME}`;

  const focusRingClassName = 'focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] focus-visible:outline-offset-2';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        data-testid="zhiyu-harness-handoff-dialog"
        className="max-h-[85dvh] max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden text-[var(--nimi-text-primary)]"
      >
        <DialogHeader className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Briefcase size={17} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
            <DialogTitle className="text-base font-semibold tracking-[-0.015em] text-[var(--nimi-text-primary)]">
              交给 {NAMED_HARNESS_DISPLAY_NAME}（可编辑简报）
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            编辑并确认要交给 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID}) 的简报内容，未勾选的对话内容会继续留在织羽。
          </DialogDescription>
          <button
            type="button"
            aria-label="关闭交接简报"
            onClick={onClose}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--nimi-text-secondary)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale)] ${focusRingClassName}`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-2">
          <div
            data-testid="zhiyu-handoff-recipient"
            className="flex items-center justify-between rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-xs"
          >
            <span className="text-[var(--nimi-text-secondary)]">确认接收应用</span>
            <span className="font-semibold text-[var(--nimi-text-primary)]">
              {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID})
            </span>
          </div>

          {/* Zone 1: What WILL be sent to Nimi Harness (editable & opt-in) */}
          <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[var(--nimi-text-primary)]">
                交给 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID}) 的最终简报（仅发送你编辑并确认的内容）
              </p>
              {(hasDraftEdits || inFlightSubmission || acceptedSubmission || unconfirmedAttempt) ? (
                <button
                  type="button"
                  data-testid="zhiyu-handoff-reset-draft"
                  onClick={resetFreshDraft}
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] ${focusRingClassName}`}
                >
                  重置草稿
                </button>
              ) : null}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[var(--nimi-text-secondary)]">任务目标</span>
              <input
                type="text"
                data-testid="zhiyu-handoff-goal-input"
                value={goal}
                onChange={(e) => {
                  updateDraft(e.target.value, points, extraNotes);
                }}
                placeholder="例如：把刚才聊的五一出行计划整理成桌面 Markdown 文档"
                className={`rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] ${focusRingClassName}`}
              />
            </label>

            {points.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[var(--nimi-text-secondary)]">聊天要点（默认未选，可勾选、编辑或移除）</span>
                {points.map((pt) => (
                  <div key={pt.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pt.selected}
                      onChange={() => togglePoint(pt.id)}
                      aria-label={`勾选要点 ${pt.text}`}
                      className={`h-4 w-4 shrink-0 rounded ${focusRingClassName}`}
                    />
                    <input
                      type="text"
                      aria-label={`编辑要点 ${pt.text}`}
                      value={pt.text}
                      onChange={(e) => updatePointText(pt.id, e.target.value)}
                      className={`flex-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-xs ${focusRingClassName}`}
                    />
                    <button
                      type="button"
                      aria-label={`移除要点 ${pt.text}`}
                      onClick={() => removePoint(pt.id)}
                      className={`rounded-md p-1 text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] ${focusRingClassName}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-[var(--nimi-text-secondary)]">补充要求（可选）</span>
              <textarea
                rows={2}
                data-testid="zhiyu-handoff-notes-input"
                value={extraNotes}
                onChange={(e) => {
                  updateDraft(goal, points, e.target.value);
                }}
                placeholder="例如：输出路径、预算范围、期望格式…"
                className={`rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs text-[var(--nimi-text-primary)] ${focusRingClassName}`}
              />
            </label>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[var(--nimi-text-secondary)]">
                <span>最终发送简报预览</span>
                <span
                  data-testid="zhiyu-handoff-budget"
                  className={overBudget ? 'font-semibold text-[var(--nimi-status-danger-soft-text)]' : undefined}
                >
                  {briefPreview.length} / {MAX_HANDOFF_BRIEF_CHARS}
                </span>
              </div>
              <pre
                data-testid="zhiyu-handoff-preview"
                className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-2 text-xs text-[var(--nimi-text-primary)]"
              >
                {briefPreview || '（尚未填写任务目标或勾选要点）'}
              </pre>
              {overBudget ? (
                <p className="text-[var(--nimi-status-danger-soft-text)]">
                  已超出 {MAX_HANDOFF_BRIEF_CHARS} 字上限，请精简草稿后再提交（不会自动截断）。
                </p>
              ) : null}
            </div>
          </fieldset>

          {/* Zone 2: What stays strictly inside Zhiyu */}
          <div
            data-testid="zhiyu-handoff-privacy-boundary"
            className="flex items-start gap-2 rounded-xl bg-[var(--nimi-status-info-soft-bg)] px-3 py-2.5 text-xs text-[var(--nimi-text-secondary)]"
          >
            <ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]" />
            <div>
              <p className="font-medium text-[var(--nimi-text-primary)]">留在织羽的内容</p>
              <p>{stayedNotice}</p>
            </div>
          </div>

          {activeRequest ? (
            <div
              role="status"
              data-testid="zhiyu-handoff-awaiting"
              data-request-id={activeRequest.payload.requestId}
              className="flex flex-col gap-1.5 rounded-xl bg-[var(--nimi-status-info-soft-bg)] px-3 py-2.5 text-xs text-[var(--nimi-text-primary)]"
            >
              <div className="flex items-start gap-2">
                <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  已向 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID}) 发出请求，尚无权威回执（请求编号已锁定，不会重复创建同一版本任务）。
                </span>
              </div>
              <div className="rounded-lg bg-[var(--nimi-surface-panel)] px-2.5 py-1.5 text-[11px]">
                <p className="font-medium">等待回执的原简报内容：</p>
                <pre data-testid="zhiyu-handoff-awaiting-brief" className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
                  {activeRequest.payload.handoffBriefText}
                </pre>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              data-testid="zhiyu-handoff-error"
              data-outcome={rejectedOutcome ?? 'UNCONFIRMED'}
              className="flex items-center gap-2 rounded-xl bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-danger-soft-text)]"
            >
              <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {inFlightSubmission ? (
            <div
              role="status"
              data-testid="zhiyu-handoff-receipt"
              data-outcome={inFlightSubmission.receipt.outcome}
              className="flex flex-col gap-1.5 rounded-xl bg-[var(--nimi-status-warning-soft-bg)] px-3 py-2.5 text-xs text-[var(--nimi-status-warning-soft-text)]"
            >
              <div className="flex items-start gap-2">
                <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  已为已验证的 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID}) 入队等待上线（会话编号：{inFlightSubmission.receipt.resolvedWorkSessionRef}）。尚未送达或完成；仅该原接收方上线后投递。你仍可继续编辑上方草稿。
                </span>
              </div>
              <div className="rounded-lg bg-[var(--nimi-surface-panel)] px-2.5 py-1.5 text-[11px]">
                <p className="font-medium">已在途简报内容（原收件方：{NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID})）：</p>
                <pre data-testid="zhiyu-handoff-inflight-brief" className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
                  {inFlightSubmission.payload.handoffBriefText}
                </pre>
              </div>
            </div>
          ) : null}

          {acceptedSubmission ? (
            <div
              role="status"
              data-testid="zhiyu-handoff-receipt"
              data-outcome={acceptedSubmission.receipt.outcome}
              className="flex flex-col gap-1.5 rounded-xl bg-[var(--nimi-status-success-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-success-soft-text)]"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} aria-hidden="true" className="shrink-0" />
                <span>
                  已提交给已验证的 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID})（会话编号：{acceptedSubmission.receipt.resolvedWorkSessionRef}）。后续执行与结果由 Nimi Harness 负责。
                </span>
              </div>
              {!isSameAsAccepted ? (
                <div className="rounded-lg bg-[var(--nimi-surface-panel)] px-2.5 py-1.5 text-[11px]">
                  <p className="font-medium">已确认受理的原简报内容：</p>
                  <pre data-testid="zhiyu-handoff-accepted-brief" className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
                    {acceptedSubmission.payload.handoffBriefText}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {requiresReconfirmForNewSend ? (
            <label
              data-testid="zhiyu-handoff-reconfirm"
              className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2.5 text-xs text-[var(--nimi-text-primary)]"
            >
              <input
                type="checkbox"
                data-testid="zhiyu-handoff-reconfirm-checkbox"
                checked={reconfirmed}
                onChange={(e) => updateScopeState(scopeKey, (prev) => ({ ...prev, reconfirmed: e.target.checked }))}
                className={`mt-0.5 ${focusRingClassName}`}
              />
              <span>
                我已核对上方修改后的最终简报，确认作为新的一笔交给 {NAMED_HARNESS_DISPLAY_NAME} ({NAMED_HARNESS_APP_ID})
                {inFlightSubmission
                  ? `（原已在途版本 ${inFlightSubmission.receipt.resolvedWorkSessionRef} 仍保留给原接收方，不会自动撤回）`
                  : activeRequest
                    ? '（上一笔请求仍在等待回执，新提交会作为独立任务发送）'
                    : unconfirmedAttempt
                      ? '（上一笔未获权威回执的请求可能已送达，新提交会作为独立任务发送）'
                      : ''}。
              </span>
            </label>
          ) : null}
        </DialogBody>

        <DialogFooter className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
          <Button
            type="button"
            tone="ghost"
            size="sm"
            onClick={onClose}
            className="hover:bg-[var(--nimi-action-ghost-hover)]"
          >
            {activeReceipt ? '完成' : '取消'}
          </Button>
          <Button
            type="button"
            tone="primary"
            size="sm"
            disabled={submitDisabled}
            loading={isSameAsActive}
            data-testid="zhiyu-handoff-submit"
            onClick={() => void handleSubmit()}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
