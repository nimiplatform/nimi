/**
 * timeline-reminder-row.tsx — row renderer for the ReminderPanel main items
 * loop on the timeline dashboard.
 *
 * Entire row is clickable to open ReminderExplainDrawer (PO-REMI-011). Task-kind
 * items keep the left check circle as a one-click-complete affordance so parents
 * can still dispatch obvious medical/record actions without going through the
 * drawer. Non-task items show a kind glyph + progression note so the parent can
 * see at-a-glance whether a guide is already acknowledged, a practice is in
 * progress, or a consult is already done.
 */

import type { ActiveReminder } from '../../engine/reminder-engine.js';
import type { ReminderActionType } from '../../engine/reminder-actions.js';
import { currentProgressionState } from '../../engine/reminder-progression.js';

interface ReminderRowProps {
  reminder: ActiveReminder;
  onOpen: () => void;
  onAction: (
    reminder: ActiveReminder,
    action: ReminderActionType,
    extra?: string | null,
  ) => void;
  statusLabel: string;
}

export function TimelineReminderRow({ reminder, onOpen, onAction, statusLabel }: ReminderRowProps) {
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

  const kindGlyph = (() => {
    switch (reminder.kind) {
      case 'guide':    return { icon: '📖', tooltip: '读指南后应用' };
      case 'practice': return { icon: '✍️', tooltip: '持续实践' };
      case 'consult':  return { icon: '💬', tooltip: '可与 AI 顾问对话' };
      default:          return null;
    }
  })();

  const progressionNote = (() => {
    if (reminder.kind === 'guide' && progression === 'acknowledged') return '已了解';
    if (reminder.kind === 'guide' && progression === 'reflected') return '已反思';
    if (reminder.kind === 'practice' && progression === 'practicing') {
      const count = reminder.state?.practiceCount ?? 0;
      return count > 0 ? `实践中 · 已 ${count} 次` : '实践中';
    }
    if (reminder.kind === 'practice' && progression === 'habituated') return '已成为习惯';
    if (reminder.kind === 'consult' && progression === 'consulted') return '已咨询';
    return null;
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex items-start gap-3 rounded-[12px] px-3 py-3.5 transition-colors hover:bg-white cursor-pointer"
    >
      {reminder.kind === 'task' ? (
        <button
          type="button"
          title="标记完成"
          onClick={(event) => {
            event.stopPropagation();
            onAction(reminder, 'complete');
          }}
          className="mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-all hover:border-[#4ECCA3]"
          style={{ borderColor: '#D0D3D8' }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
      ) : (
        <span
          aria-label={kindGlyph?.tooltip ?? reminder.kind}
          title={kindGlyph?.tooltip}
          className="mt-[1px] flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full text-[12px]"
          style={{ background: '#f1f5f9' }}
        >
          {kindGlyph?.icon ?? '•'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[14px] font-medium leading-snug" style={{ color: '#1e293b' }}>{reminder.rule.title}</p>
          <span className="shrink-0 text-[12px]" style={{ color: '#64748b' }}>{statusLabel}</span>
        </div>
        {progressionNote ? (
          <p className="mt-0.5 text-[12px]" style={{ color: '#64748b' }}>{progressionNote}</p>
        ) : null}
      </div>
    </div>
  );
}
