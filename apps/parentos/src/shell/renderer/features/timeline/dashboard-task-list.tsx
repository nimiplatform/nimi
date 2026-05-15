// Dashboard Task List surface — implementation of
// `apps/parentos/spec/kernel/timeline-contract.md#PO-TIME-010`
// (UI proof; deterministic local projection authored in
// `dashboard-task-projection.ts`).
//
// Renders a small daily task list mixing must-do reminders, maintain /
// observe catalog rows, and personal custom todos. Maintain rows route
// the parent into the existing `HealthCaptureModal` via a `dashboard_task`
// origin capture intent (PO-CAPT-005a). No new save path; no new modal;
// no renderer-local catalog rules.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Cd, Hdr, textMain, textMuted, textSoft } from './timeline-card-primitives.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';
import { DASHBOARD_TASK_CATALOG, type DashboardTaskCatalogRow } from '../../knowledge-base/index.js';
import {
  buildDashboardTaskCaptureIntent,
  buildDashboardTaskProjection,
  type DashboardTaskEntry,
} from './dashboard-task-projection.js';

export interface DashboardTaskCaptureIntent {
  origin: 'dashboard_task';
  dashboardTaskId: string;
  childId: string;
  captureProtocolId: string;
  metricIds: readonly string[];
}

export interface DashboardTaskListProps {
  today: string;
  child: { childId: string; birthDate: string };
  reminderAgenda: ReminderAgenda;
  customTodos: readonly CustomTodoRow[];
  /** Override catalog rows in tests. Production passes `DASHBOARD_TASK_CATALOG`. */
  catalogRows?: readonly DashboardTaskCatalogRow[];
  /** Called when a `maintain` card's primary action fires. Caller wires the
   *  intent into the existing `HealthCaptureModal` state. */
  onDashboardTaskCapture: (intent: DashboardTaskCaptureIntent) => void;
}

function catalogTitle(row: DashboardTaskCatalogRow): string {
  switch (row.taskId) {
    case 'dashboard-maintain-growth-infant':
      return '看看这个月长高了吗？';
    case 'dashboard-maintain-growth-child':
      return '记录一下身高体重';
    case 'dashboard-maintain-sleep':
      return '昨晚睡得怎么样？';
    case 'dashboard-maintain-outdoor':
      return '本周户外目标进展';
    case 'dashboard-maintain-vision':
      return '更新一下视力记录';
    case 'dashboard-observe-growth-journal':
      return '今天有让你印象深的瞬间吗？';
    default:
      return row.taskId;
  }
}

function catalogDetail(row: DashboardTaskCatalogRow): string {
  if (row.family === 'maintain') return '20 秒记录一下，生长曲线会更完整。';
  if (row.family === 'observe') return '记一段小观察，留住这个阶段的真实变化。';
  return '';
}

function catalogActionLabel(row: DashboardTaskCatalogRow): string {
  if (row.family === 'maintain') return '记录';
  if (row.family === 'observe') return '记到成长随记';
  return '';
}

function reminderTitle(reminder: ActiveReminder): string {
  // Re-use the rule's `title` field when present; fall back to ruleId.
  // The full title resolution lives in the existing reminder rendering surface; the dashboard
  // list shows a short label only.
  const rule = reminder.rule as unknown as { title?: string; ruleId: string };
  return rule.title ?? rule.ruleId;
}

function CatalogCard({
  entry,
  childId,
  onDashboardTaskCapture,
}: {
  entry: DashboardTaskEntry;
  childId: string;
  onDashboardTaskCapture: (intent: DashboardTaskCaptureIntent) => void;
}) {
  const row = entry.catalogRow!;
  const title = catalogTitle(row);
  const detail = catalogDetail(row);
  const actionLabel = catalogActionLabel(row);

  if (row.family === 'maintain') {
    const intent = buildDashboardTaskCaptureIntent(row, childId);
    return (
      <Cd cls="mb-3" material="glass-regular">
        <div data-testid={`dashboard-task-card-${row.taskId}`} className="flex flex-col gap-2">
          <h4 className="text-[15px] font-semibold" style={{ color: textMain }}>{title}</h4>
          {detail ? <p className="text-[13px]" style={{ color: textMuted }}>{detail}</p> : null}
          <button
            type="button"
            className="self-start rounded-full px-3 py-1 text-[13px] font-medium"
            style={{ color: textMain, background: '#e2e8f0' }}
            onClick={() => intent && onDashboardTaskCapture(intent)}
            data-testid={`dashboard-task-action-${row.taskId}`}
          >
            {actionLabel}
          </button>
        </div>
      </Cd>
    );
  }

  if (row.family === 'observe') {
    return (
      <Cd cls="mb-3" material="glass-regular">
        <div data-testid={`dashboard-task-card-${row.taskId}`} className="flex flex-col gap-2">
          <h4 className="text-[15px] font-semibold" style={{ color: textMain }}>{title}</h4>
          {detail ? <p className="text-[13px]" style={{ color: textMuted }}>{detail}</p> : null}
          <Link
            to="/journal"
            className="self-start rounded-full px-3 py-1 text-[13px] font-medium no-underline"
            style={{ color: textMain, background: '#e2e8f0' }}
            data-testid={`dashboard-task-action-${row.taskId}`}
          >
            {actionLabel}
          </Link>
        </div>
      </Cd>
    );
  }

  // connect / must-do catalog rows are not admitted in wave-2; render a
  // neutral row so the schema is honored without exposing unfinished surfaces.
  return null;
}

function ReminderRow({ entry }: { entry: DashboardTaskEntry }) {
  const reminder = entry.reminder!;
  const title = reminderTitle(reminder);
  const isP0 = entry.priority === 'P0';
  return (
    <div
      data-testid={`dashboard-task-reminder-${reminder.rule.ruleId}`}
      data-priority={entry.priority}
      data-display-state={entry.displayState}
      className="mb-2 flex flex-col gap-1 rounded-md p-3"
      style={{ background: isP0 ? '#fff7ed' : '#f8fafc' }}
    >
      <span className="text-[13px] font-semibold" style={{ color: textMain }}>{title}</span>
      <span className="text-[12px]" style={{ color: textMuted }}>{isP0 ? 'P0 · 今日重要' : '今日'}</span>
    </div>
  );
}

function PersonalRow({ entry }: { entry: DashboardTaskEntry }) {
  const todo = entry.customTodo!;
  const todoAny = todo as unknown as { title?: string; todoId: string };
  return (
    <div
      data-testid={`dashboard-task-personal-${todo.todoId}`}
      className="mb-2 rounded-md p-3 text-[13px]"
      style={{ background: '#f1f5f9', color: textMain }}
    >
      {todoAny.title ?? todo.todoId}
    </div>
  );
}

export function DashboardTaskList(props: DashboardTaskListProps) {
  const {
    today,
    child,
    reminderAgenda,
    customTodos,
    catalogRows = DASHBOARD_TASK_CATALOG,
    onDashboardTaskCapture,
  } = props;

  const projection = useMemo(
    () => buildDashboardTaskProjection({
      today,
      child,
      reminderAgenda,
      customTodos,
      catalogRows,
    }),
    [today, child, reminderAgenda, customTodos, catalogRows],
  );

  return (
    <Cd cls="mb-4">
      <Hdr title="今日任务" />
      <div data-testid="dashboard-task-list">
        {projection.mainList.map((entry) => {
          if (entry.source === 'reminder') return <ReminderRow key={entry.key} entry={entry} />;
          if (entry.source === 'catalog') {
            return (
              <CatalogCard
                key={entry.key}
                entry={entry}
                childId={child.childId}
                onDashboardTaskCapture={onDashboardTaskCapture}
              />
            );
          }
          return <PersonalRow key={entry.key} entry={entry} />;
        })}
        {projection.downgradeIndicatorCount > 0 ? (
          <div
            data-testid="dashboard-task-downgrade-indicator"
            className="mt-2 rounded-md p-2 text-[12px]"
            style={{ background: '#f8fafc', color: textSoft }}
          >
            档案有 {projection.downgradeIndicatorCount} 项可更新
          </div>
        ) : null}
      </div>
    </Cd>
  );
}
