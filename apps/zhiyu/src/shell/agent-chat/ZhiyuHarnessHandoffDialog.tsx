import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, Clock, ShieldCheck, X } from 'lucide-react';
import {
  buildEditableHandoffBriefDraft,
  composeHandoffBriefPayload,
  submitZhiyuHarnessHandoff,
  type ZhiyuHandoffBriefPoint,
  type ZhiyuHandoffSubmitResult,
} from './zhiyu-harness-handoff';

const EMPTY_TOPIC_HINTS: readonly string[] = [];

export type ZhiyuHarnessHandoffDialogProps = {
  readonly open: boolean;
  readonly partnerName: string;
  readonly agentHandle: string | null;
  readonly currentDraft: string;
  readonly recentTopicHints?: readonly string[];
  readonly onClose: () => void;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.harness-brief-handoff
export function ZhiyuHarnessHandoffDialog({
  open,
  partnerName,
  agentHandle,
  currentDraft,
  recentTopicHints = EMPTY_TOPIC_HINTS,
  onClose,
}: ZhiyuHarnessHandoffDialogProps) {
  const [goal, setGoal] = useState('');
  const [points, setPoints] = useState<readonly ZhiyuHandoffBriefPoint[]>([]);
  const [extraNotes, setExtraNotes] = useState('');
  const [stayedNotice, setStayedNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ZhiyuHandoffSubmitResult | null>(null);
  const wasOpenRef = useRef(false);
  const openGenerationRef = useRef(0);
  const stableRequestIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    const justClosed = !open && wasOpenRef.current;
    wasOpenRef.current = open;
    if (justClosed) {
      openGenerationRef.current += 1;
      setSubmitting(false);
      return;
    }
    if (!justOpened) return;
    openGenerationRef.current += 1;
    const draft = buildEditableHandoffBriefDraft({
      partnerName,
      currentDraft,
      recentTopicHints,
    });
    setGoal(draft.goal);
    setPoints(draft.points);
    setExtraNotes(draft.extraNotes);
    setStayedNotice(draft.stayedInZhiyuNotice);
    setError(null);
    setReceipt(null);
    setSubmitting(false);
    stableRequestIdRef.current = undefined;
  }, [open, partnerName, currentDraft, recentTopicHints]);

  if (!open) return null;

  const togglePoint = (id: string) => {
    stableRequestIdRef.current = undefined;
    setPoints((prev) => prev.map((pt) => (pt.id === id ? { ...pt, selected: !pt.selected } : pt)));
  };

  const updatePointText = (id: string, text: string) => {
    stableRequestIdRef.current = undefined;
    setPoints((prev) => prev.map((pt) => (pt.id === id ? { ...pt, text } : pt)));
  };

  const handleSubmit = async () => {
    setError(null);
    setReceipt(null);
    const generation = openGenerationRef.current;
    try {
      const payload = composeHandoffBriefPayload({
        agentHandle: agentHandle ?? '',
        goal,
        points,
        extraNotes,
        requestId: stableRequestIdRef.current,
      });
      stableRequestIdRef.current = payload.requestId;
      setSubmitting(true);
      const res = await submitZhiyuHarnessHandoff(payload);
      if (generation !== openGenerationRef.current) return;
      if (res.outcome === 'ACCEPTED' || res.outcome === 'DEFERRED_BODY_OFFLINE') {
        setReceipt(res);
      } else if (res.outcome === 'AMBIGUOUS_CANDIDATES') {
        stableRequestIdRef.current = undefined;
        setError('存在多个可继续的本机任务候选，请补充更明确的任务目标，或在 Nimi Home 中选择具体任务后再提交。');
      } else {
        stableRequestIdRef.current = undefined;
        setError('未能确认任务已进入办理队列，请检查本机服务状态后重试。');
      }
    } catch (err) {
      if (generation !== openGenerationRef.current) return;
      setError(err instanceof Error ? err.message : '转交 Harness 失败，请稍后重试。');
    } finally {
      if (generation === openGenerationRef.current) {
        setSubmitting(false);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="转交 Harness 办理（可编辑简报）"
      data-testid="zhiyu-harness-handoff-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 text-[var(--nimi-text-primary)] shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Briefcase size={17} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
            <h2 className="text-base font-semibold">转交 Harness 办理（可编辑简报）</h2>
          </div>
          <button
            type="button"
            aria-label="关闭交接简报"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--nimi-text-secondary)] hover:bg-black/5"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Zone 1: What WILL be sent to Harness (editable & opt-in) */}
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3.5 text-xs">
          <p className="font-semibold text-[var(--nimi-text-primary)]">
            将带给 Harness 的简报（仅发送你确认和编辑后的内容）
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-[var(--nimi-text-secondary)]">任务目标</span>
            <input
              type="text"
              data-testid="zhiyu-handoff-goal-input"
              value={goal}
              onChange={(e) => {
                stableRequestIdRef.current = undefined;
                setGoal(e.target.value);
              }}
              placeholder="例如：把刚才聊的五一出行计划整理成桌面 Markdown 文档"
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
            />
          </label>

          {points.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[var(--nimi-text-secondary)]">可选要点（取消勾选即不传出）</span>
              {points.map((pt) => (
                <div key={pt.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={pt.selected}
                    onChange={() => togglePoint(pt.id)}
                    aria-label={`勾选要点 ${pt.text}`}
                  />
                  <input
                    type="text"
                    value={pt.text}
                    onChange={(e) => updatePointText(pt.id, e.target.value)}
                    className="flex-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-xs"
                  />
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
                stableRequestIdRef.current = undefined;
                setExtraNotes(e.target.value);
              }}
              placeholder="例如：输出路径、预算范围、期望格式…"
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs text-[var(--nimi-text-primary)]"
            />
          </label>
        </div>

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

        {error ? (
          <div
            role="alert"
            data-testid="zhiyu-handoff-error"
            className="flex items-center gap-2 rounded-xl bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-danger-soft-text)]"
          >
            <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {receipt ? (
          <div
            role="status"
            data-testid="zhiyu-handoff-receipt"
            data-outcome={receipt.outcome}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
              receipt.outcome === 'DEFERRED_BODY_OFFLINE'
                ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]'
                : 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]'
            }`}
          >
            {receipt.outcome === 'DEFERRED_BODY_OFFLINE' ? (
              <Clock size={14} aria-hidden="true" className="shrink-0" />
            ) : (
              <CheckCircle2 size={14} aria-hidden="true" className="shrink-0" />
            )}
            <span>
              {receipt.outcome === 'DEFERRED_BODY_OFFLINE'
                ? `已排队等待 PC 执行体上线（会话编号：${receipt.resolvedWorkSessionRef}）。打开已安装的本机执行 App 后将自动继续。`
                : `已交给本机执行 App 启动任务（会话编号：${receipt.resolvedWorkSessionRef}）。`}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2 text-xs text-[var(--nimi-text-secondary)] hover:bg-black/5"
          >
            {receipt ? '完成' : '取消'}
          </button>
          {!receipt ? (
            <button
              type="button"
              disabled={submitting || !agentHandle}
              data-testid="zhiyu-handoff-submit"
              onClick={() => void handleSubmit()}
              className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-semibold text-[var(--nimi-action-primary-text)] hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '正在转交…' : '确认转交 Harness'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
