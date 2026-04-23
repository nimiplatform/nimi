/**
 * ReminderExplainDrawer — per-kind reminder disclosure surface.
 *
 * Authoritative contract: reminder-interaction-contract.md#PO-REMI-011
 *
 * Consumed by both the timeline panel (W5b) and the /reminders page (W5c).
 * Props are fully controlled: the parent owns open/close state and dispatches
 * actions back through `onAction`. The drawer does not call the engine
 * directly — it emits UI-level action verbs (ReminderActionType from
 * reminder-actions.ts) that the parent forwards to `applyReminderAction`.
 *
 * Footer dispatch per user confirmation: terminal-ish progression states
 * (acknowledged / practicing / consulted) still show a forward action rather
 * than disabled history text, because guide/practice/consult items are
 * intentionally cyclic or invite deeper engagement.
 */

import { Link } from 'react-router-dom';
import type { ReminderKind } from '../../knowledge-base/index.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import {
  canMarkNotApplicable,
  defaultSnoozeUntil,
  type ReminderActionType,
} from '../../engine/reminder-actions.js';
import { currentProgressionState } from '../../engine/reminder-progression.js';
import { getLocalToday } from '../../engine/reminder-engine.js';

const DRAWER_WIDTH = 440;

export interface ReminderExplainDrawerProps {
  reminder: ActiveReminder | null;
  onClose: () => void;
  onAction: (reminder: ActiveReminder, action: ReminderActionType, extra?: string | null) => void;
}

interface FooterPrimary {
  variant: 'action' | 'link';
  label: string;
  action?: ReminderActionType;
  to?: string;
}

/**
 * Per-kind / per-progression footer action resolution per PO-REMI-005 and the
 * user-approved UI dispatch table.
 */
function resolveFooterPrimary(reminder: ActiveReminder): FooterPrimary[] {
  const kind: ReminderKind = reminder.kind;
  const progression = currentProgressionState({
    kind,
    acknowledgedAt: reminder.state?.acknowledgedAt ?? null,
    reflectedAt: reminder.state?.reflectedAt ?? null,
    practiceStartedAt: reminder.state?.practiceStartedAt ?? null,
    practiceLastAt: reminder.state?.practiceLastAt ?? null,
    practiceCount: reminder.state?.practiceCount ?? 0,
    practiceHabituatedAt: reminder.state?.practiceHabituatedAt ?? null,
    consultedAt: reminder.state?.consultedAt ?? null,
    consultationConversationId: reminder.state?.consultationConversationId ?? null,
    completedAt: reminder.state?.completedAt ?? null,
    notApplicable: reminder.state?.notApplicable ?? 0,
  });
  const ruleRoute = `?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`;

  if (kind === 'task') {
    if (progression === 'completed') {
      return [{ variant: 'action', label: '恢复', action: 'restore' }];
    }
    switch (reminder.rule.actionType) {
      case 'go_hospital':
        if (reminder.rule.domain === 'vaccine') {
          return [
            { variant: 'link', label: '记录疫苗', to: `/profile/vaccines?ruleId=${encodeURIComponent(reminder.rule.ruleId)}` },
            { variant: 'action', label: '标记完成', action: 'complete' },
          ];
        }
        return [
          { variant: 'link', label: '查看档案', to: '/profile' },
          { variant: 'action', label: '标记完成', action: 'complete' },
        ];
      case 'record_data':
        return [
          { variant: 'link', label: '去记录', to: '/profile/growth' },
          { variant: 'action', label: '标记完成', action: 'complete' },
        ];
      default:
        return [{ variant: 'action', label: '标记完成', action: 'complete' }];
    }
  }

  if (kind === 'guide') {
    if (progression === 'reflected') {
      return [{ variant: 'action', label: '恢复', action: 'restore' }];
    }
    if (progression === 'acknowledged') {
      return [{ variant: 'action', label: '我反思了', action: 'reflect' }];
    }
    return [{ variant: 'action', label: '我已了解', action: 'acknowledge' }];
  }

  if (kind === 'practice') {
    if (progression === 'habituated') {
      return [{ variant: 'action', label: '恢复', action: 'restore' }];
    }
    if (progression === 'practicing') {
      return [
        { variant: 'action', label: '再做一次', action: 'log_practice' },
        { variant: 'action', label: '已成为习惯', action: 'mark_habituated' },
      ];
    }
    return [{ variant: 'action', label: '开始实践', action: 'start_practicing' }];
  }

  // consult
  if (progression === 'consulted') {
    return [
      { variant: 'link', label: '重新打开对话', to: `/advisor${ruleRoute}` },
    ];
  }
  return [{ variant: 'link', label: '问问 AI 顾问', to: `/advisor${ruleRoute}` }];
}

const KIND_BADGE: Record<ReminderKind, { label: string; fg: string; bg: string }> = {
  task:     { label: '记录型',   fg: '#1d4ed8', bg: '#dbeafe' },
  guide:    { label: '指南型',   fg: '#9333ea', bg: '#f3e8ff' },
  practice: { label: '实践型',   fg: '#047857', bg: '#d1fae5' },
  consult:  { label: '咨询型',   fg: '#c2410c', bg: '#fed7aa' },
};

const PROGRESSION_LABEL: Record<string, string> = {
  pending: '等待触发',
  due: '待处理',
  acknowledged: '已了解',
  reflected: '已反思',
  practicing: '实践中',
  habituated: '已成为习惯',
  consulted: '已咨询',
  completed: '已完成',
  snoozed: '已推迟',
  scheduled: '已安排',
  not_applicable: '不适用',
};

function isExplainComplete(reminder: ActiveReminder): boolean {
  const explain = reminder.rule.explain;
  if (reminder.kind === 'task') return true; // explain optional for task per PO-REMI-006
  if (!explain) return false;
  return (
    typeof explain.whyNow === 'string'
    && explain.whyNow.trim().length > 0
    && Array.isArray(explain.howTo)
    && explain.howTo.length >= 3
    && typeof explain.doneWhen === 'string'
    && explain.doneWhen.trim().length > 0
    && Array.isArray(explain.sources)
    && explain.sources.length > 0
  );
}

export function ReminderExplainDrawer({ reminder, onClose, onAction }: ReminderExplainDrawerProps) {
  if (!reminder) return null;

  const explain = reminder.rule.explain;
  const complete = isExplainComplete(reminder);
  const kindBadge = KIND_BADGE[reminder.kind];
  const progression = currentProgressionState({
    kind: reminder.kind,
    acknowledgedAt: reminder.state?.acknowledgedAt ?? null,
    reflectedAt: reminder.state?.reflectedAt ?? null,
    practiceStartedAt: reminder.state?.practiceStartedAt ?? null,
    practiceLastAt: reminder.state?.practiceLastAt ?? null,
    practiceCount: reminder.state?.practiceCount ?? 0,
    practiceHabituatedAt: reminder.state?.practiceHabituatedAt ?? null,
    consultedAt: reminder.state?.consultedAt ?? null,
    consultationConversationId: reminder.state?.consultationConversationId ?? null,
    completedAt: reminder.state?.completedAt ?? null,
    notApplicable: reminder.state?.notApplicable ?? 0,
  });

  const primaries = complete ? resolveFooterPrimary(reminder) : [];
  const notApplicableOk = canMarkNotApplicable(reminder);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.28)] transition-opacity"
      />
      <aside
        role="dialog"
        aria-label={`提醒详情：${reminder.rule.title}`}
        className="fixed right-0 top-0 z-50 flex h-full flex-col bg-white shadow-[-18px_0_48px_rgba(15,23,42,0.14)]"
        style={{ width: DRAWER_WIDTH }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b px-6 py-5" style={{ borderColor: '#eceae4' }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold tracking-[0.04em]"
                style={{ background: kindBadge.bg, color: kindBadge.fg }}
              >
                {kindBadge.label}
              </span>
              <span className="text-[10px]" style={{ color: '#94a3b8' }}>
                {PROGRESSION_LABEL[progression] ?? progression}
              </span>
              {reminder.kind === 'practice' && reminder.state?.practiceCount ? (
                <span className="text-[10px]" style={{ color: '#64748b' }}>
                  · 实践 {reminder.state.practiceCount} 次
                </span>
              ) : null}
            </div>
            <h2 className="mt-1.5 text-[16px] font-semibold leading-snug tracking-tight" style={{ color: '#0f172a' }}>
              {reminder.rule.title}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: '#475569' }}>
              {reminder.rule.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[#f0f0ec]"
            style={{ color: '#b0b5bc' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!complete ? (
            <ExplainIncompletePlaceholder kind={reminder.kind} />
          ) : explain ? (
            <>
              {explain.whyNow && (
                <Section title="为什么现在">
                  <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>{explain.whyNow}</p>
                </Section>
              )}
              {explain.howTo && explain.howTo.length > 0 && (
                <Section title="怎么做">
                  <ol className="ml-4 list-decimal space-y-1.5">
                    {explain.howTo.map((step, index) => (
                      <li key={index} className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>
                        {step}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
              {explain.doneWhen && (
                <Section title="做到什么算到位">
                  <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>{explain.doneWhen}</p>
                </Section>
              )}
              {explain.pitfalls && explain.pitfalls.length > 0 && (
                <Section title="常见陷阱">
                  <ul className="ml-4 list-disc space-y-1">
                    {explain.pitfalls.map((item, index) => (
                      <li key={index} className="text-[12px] leading-relaxed" style={{ color: '#475569' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {explain.ifNotNow && (
                <Section title="现在不方便">
                  <p className="text-[12px] leading-relaxed" style={{ color: '#475569' }}>{explain.ifNotNow}</p>
                </Section>
              )}
              {explain.sources && explain.sources.length > 0 && (
                <Section title="依据">
                  <ul className="space-y-1">
                    {explain.sources.map((source, index) => (
                      <li key={index} className="text-[11px]" style={{ color: '#64748b' }}>
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-[#1e293b]"
                          >
                            {source.citation}
                          </a>
                        ) : (
                          source.citation
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          ) : (
            // Task rules are allowed to omit explain. Render title + description only.
            <p className="text-[13px] leading-relaxed" style={{ color: '#475569' }}>
              {reminder.rule.description}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4" style={{ borderColor: '#eceae4', background: '#fafaf8' }}>
          <div className="flex flex-wrap items-center gap-2">
            {primaries.map((primary, index) => {
              const isPrimary = index === 0;
              const className = `inline-flex h-9 items-center justify-center rounded-full px-4 text-[12px] font-medium transition-colors ${
                isPrimary ? 'text-white' : ''
              }`;
              const style = isPrimary
                ? { background: '#1e293b' }
                : { background: '#fff', color: '#1e293b', border: '1px solid #e2e8f0' };
              if (primary.variant === 'link' && primary.to) {
                return (
                  <Link key={`${primary.label}-${index}`} to={primary.to} onClick={onClose} className={className} style={style}>
                    {primary.label}
                  </Link>
                );
              }
              if (primary.variant === 'action' && primary.action) {
                const action = primary.action;
                return (
                  <button
                    key={`${primary.label}-${index}`}
                    type="button"
                    onClick={() => {
                      onAction(reminder, action);
                      onClose();
                    }}
                    className={className}
                    style={style}
                  >
                    {primary.label}
                  </button>
                );
              }
              return null;
            })}

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onAction(reminder, 'snooze', defaultSnoozeUntil(reminder.kind, getLocalToday()));
                  onClose();
                }}
                className="inline-flex h-9 items-center rounded-full px-3 text-[11px] transition-colors hover:bg-[#f1f5f9]"
                style={{ color: '#475569' }}
              >
                推迟
              </button>
              {notApplicableOk && (
                <button
                  type="button"
                  onClick={() => {
                    onAction(reminder, 'mark_not_applicable');
                    onClose();
                  }}
                  className="inline-flex h-9 items-center rounded-full px-3 text-[11px] transition-colors hover:bg-[#f1f5f9]"
                  style={{ color: '#475569' }}
                >
                  不适用
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#8d93a0' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ExplainIncompletePlaceholder({ kind }: { kind: ReminderKind }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-5" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
      <p className="text-[12px] font-medium" style={{ color: '#b45309' }}>
        指南正在完善
      </p>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#92400e' }}>
        这条 {KIND_BADGE[kind].label} 提醒的结构化指南尚未完整填写。为了不误导家长，抽屉暂时隐藏引导段并禁用主操作。可以到 /reminders 列表查看原始提醒描述，或联系规则作者补齐内容。
      </p>
    </div>
  );
}
