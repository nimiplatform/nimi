import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, Clock, ShieldCheck, X } from 'lucide-react';
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
      setError(err instanceof Error ? err.message : '转交本机工作台失败，请稍后重试。');
    } finally {
      if (generation === openGenerationRef.current) {
        setSubmitting(false);
      }
    }
  };

  const focusRingClassName = 'focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] focus-visible:outline-offset-2';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        onClose={onClose}
        data-testid="zhiyu-harness-handoff-dialog"
        className="max-h-[85dvh] max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden text-[var(--nimi-text-primary)]"
      >
        <DialogHeader className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Briefcase size={17} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
            <DialogTitle className="text-base font-semibold tracking-[-0.015em] text-[var(--nimi-text-primary)]">
              转交电脑工作台（可编辑简报）
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            编辑并确认要转交给电脑工作台的简报内容，未勾选的对话内容会继续留在织羽。
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
          {/* Zone 1: What WILL be sent to Harness (editable & opt-in) */}
          <fieldset
            disabled={submitting || Boolean(receipt)}
            className="flex flex-col gap-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3.5 text-xs"
          >
            <p className="font-semibold text-[var(--nimi-text-primary)]">
              交给电脑工作台的简报（仅发送你确认和编辑后的内容）
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
                className={`rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] ${focusRingClassName}`}
              />
            </label>

            {points.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[var(--nimi-text-secondary)]">勾选要随简报发送的聊天要点</span>
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
                      value={pt.text}
                      onChange={(e) => updatePointText(pt.id, e.target.value)}
                      className={`flex-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-primary)] ${focusRingClassName}`}
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
                className={`rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs text-[var(--nimi-text-primary)] ${focusRingClassName}`}
              />
            </label>
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
        </DialogBody>

        <DialogFooter className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">
          <Button
            type="button"
            tone="ghost"
            size="sm"
            onClick={onClose}
            className="hover:bg-[var(--nimi-action-ghost-hover)]"
          >
            {receipt ? '完成' : '取消'}
          </Button>
          {!receipt ? (
            <Button
              type="button"
              tone="primary"
              size="sm"
              disabled={submitting || !agentHandle}
              loading={submitting}
              data-testid="zhiyu-handoff-submit"
              onClick={() => void handleSubmit()}
            >
              {submitting ? '正在转交…' : '确认转交'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
