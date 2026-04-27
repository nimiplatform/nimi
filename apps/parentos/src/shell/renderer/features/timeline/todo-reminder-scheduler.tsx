import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import { combineDateAndReminderOffset, describeReminderOffset } from './todo-recurrence.js';

const CHECK_INTERVAL_MS = 30_000;
const LOOKBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = 'parentos:customTodoReminders:dismissed';

type FiredReminder = {
  key: string;
  todoId: string;
  title: string;
  offsetMinutes: number;
  dueDate: string;
  firedAt: number;
};

function reminderKey(todo: CustomTodoRow): string {
  return `${todo.todoId}:${todo.dueDate ?? ''}:${todo.reminderOffsetMinutes ?? ''}`;
}

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissed)));
  } catch {
    /* sessionStorage can throw in private mode — safe to ignore */
  }
}

export function useCustomTodoReminders(todos: CustomTodoRow[]) {
  const [active, setActive] = useState<FiredReminder[]>([]);
  const dismissedRef = useRef<Set<string>>(loadDismissed());

  const scan = useCallback(() => {
    const now = Date.now();
    const nextActive: FiredReminder[] = [];
    for (const todo of todos) {
      if (todo.completedAt) continue;
      if (todo.reminderOffsetMinutes === null || todo.reminderOffsetMinutes === undefined) continue;
      if (!todo.dueDate) continue;
      const fireAt = combineDateAndReminderOffset(todo.dueDate, todo.reminderOffsetMinutes);
      if (!fireAt) continue;
      const fireTs = fireAt.getTime();
      if (fireTs > now) continue;
      if (now - fireTs > LOOKBACK_WINDOW_MS) continue;
      const key = reminderKey(todo);
      if (dismissedRef.current.has(key)) continue;
      nextActive.push({
        key,
        todoId: todo.todoId,
        title: todo.title,
        offsetMinutes: todo.reminderOffsetMinutes,
        dueDate: todo.dueDate,
        firedAt: fireTs,
      });
    }
    nextActive.sort((a, b) => b.firedAt - a.firedAt);
    setActive((prev) => {
      if (prev.length === nextActive.length && prev.every((p, i) => p.key === nextActive[i]?.key)) {
        return prev;
      }
      return nextActive;
    });
  }, [todos]);

  useEffect(() => {
    scan();
    const id = window.setInterval(scan, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [scan]);

  const dismiss = useCallback((key: string) => {
    dismissedRef.current.add(key);
    saveDismissed(dismissedRef.current);
    setActive((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const dismissAll = useCallback(() => {
    for (const item of active) dismissedRef.current.add(item.key);
    saveDismissed(dismissedRef.current);
    setActive([]);
  }, [active]);

  return { active, dismiss, dismissAll };
}

export function CustomTodoReminderBanner({
  reminders,
  onDismiss,
  onDismissAll,
}: {
  reminders: ReturnType<typeof useCustomTodoReminders>['active'];
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
}) {
  const primary = reminders[0];
  const extra = reminders.length - 1;
  if (!primary) return null;
  return (
    <div className="px-5 pb-2 pt-1">
      <div
        className="flex items-start gap-3 rounded-2xl px-3.5 py-3"
        style={{ background: '#FEF3C7', border: '1px solid #FCD34D', boxShadow: '0 8px 18px rgba(252, 211, 77, 0.14)' }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: '#F59E0B', color: '#fff' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold" style={{ color: '#92400E' }}>
            {describeReminderOffset(primary.offsetMinutes)}提醒
          </div>
          <div className="mt-0.5 truncate text-[14px]" style={{ color: '#78350F' }}>
            {primary.title}
          </div>
          {extra > 0 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="mt-1 text-[13px] underline"
              style={{ color: '#92400E' }}
            >
              另有 {extra} 条，全部标记已读
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(primary.key)}
          className="-mr-1 h-6 w-6 shrink-0 rounded-full text-[16px]"
          style={{ color: '#92400E' }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Exported only for isolated testing of date math.
export const _internal = { reminderKey };
