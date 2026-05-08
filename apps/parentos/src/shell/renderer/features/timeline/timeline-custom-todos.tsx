import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLocalToday } from '../../engine/reminder-engine.js';
import {
  advanceCustomTodoDueDate,
  completeCustomTodo,
  deleteCustomTodo,
  insertCustomTodo,
  uncompleteCustomTodo,
} from '../../bridge/sqlite-bridge.js';
import type { CustomTodoRow, TodoRecurrenceRule } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { TodoDueDatePicker } from './todo-due-date-picker.js';
import { TodoRecurrencePicker } from './todo-recurrence-picker.js';
import {
  computeNextDueDate,
  describeRecurrenceRule,
  describeReminderOffset,
  parseRecurrenceRule,
  serializeRecurrenceRule,
} from './todo-recurrence.js';
import { TodoReminderPicker } from './todo-reminder-picker.js';
import { CustomTodoReminderBanner, useCustomTodoReminders } from './todo-reminder-scheduler.js';

function formatDueDate(dueDate: string): string {
  const today = getLocalToday();
  if (dueDate === today) return '今天';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dueDate === tomorrowStr) return '明天';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (dueDate === yesterdayStr) return '昨天（已逾期）';
  if (dueDate < today) {
    const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (24 * 60 * 60 * 1000));
    return `逾期${days}天`;
  }
  const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 7) return `${days}天后`;
  return new Date(dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function CustomTodoComposer({
  childId,
  onChanged,
  onAdded,
}: {
  childId: string;
  onChanged: () => void;
  onAdded: (todo: CustomTodoRow) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<TodoRecurrenceRule | null>(null);
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | null>(null);
  const [showScrollbar, setShowScrollbar] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const MAX_ROWS_HEIGHT = 74;
    textarea.style.height = '0px';
    const natural = textarea.scrollHeight;
    textarea.style.height = `${Math.min(natural, MAX_ROWS_HEIGHT)}px`;
    setShowScrollbar(natural > MAX_ROWS_HEIGHT);
  }, [newTitle]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest?.('[data-todo-composer-popover]')) return;
      setNewTitle('');
      setNewDueDate('');
      setRecurrenceRule(null);
      setReminderOffsetMinutes(null);
      setExpanded(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expanded]);

  const reset = useCallback(() => {
    setNewTitle('');
    setNewDueDate('');
    setExpanded(false);
    setRecurrenceRule(null);
    setReminderOffsetMinutes(null);
  }, []);

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const now = isoNow();
    const todoId = ulid();
    const serializedRule = serializeRecurrenceRule(recurrenceRule);
    const optimisticTodo: CustomTodoRow = {
      todoId,
      childId,
      title,
      dueDate: newDueDate || null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      recurrenceRule: serializedRule,
      reminderOffsetMinutes,
    };
    setAdding(true);
    try {
      await insertCustomTodo({
        todoId,
        childId,
        title,
        dueDate: newDueDate || null,
        recurrenceRule: serializedRule,
        reminderOffsetMinutes,
        now,
      });
      onAdded(optimisticTodo);
      onChanged();
      reset();
    } catch (error) {
      catchLog('timeline', 'action:add-custom-todo-failed')(error);
    } finally {
      setAdding(false);
    }
  }, [childId, newDueDate, newTitle, onAdded, onChanged, recurrenceRule, reminderOffsetMinutes, reset]);

  const canSubmit = newTitle.trim().length > 0 && !adding;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="group flex w-full items-center gap-3 rounded-[12px] border-[1.5px] border-dashed border-transparent px-3 py-3.5 transition-colors duration-300 ease-out hover:border-[#3BB88A] hover:bg-white"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0 text-[#9aa0a7] transition-all duration-500 ease-out group-hover:rotate-180 group-hover:scale-110 group-hover:text-[#3BB88A]"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="text-[14px] transition-all duration-300 ease-out group-hover:translate-x-0.5 group-hover:tracking-wide group-hover:text-[#3BB88A]" style={{ color: '#9aa0a7' }}>添加日常待办...</span>
      </button>
    );
  }

  return (
    <div className="pb-3 pt-3">
      <div
        ref={cardRef}
        className="todo-input-card rounded-2xl px-4 pb-3 pt-3.5 transition-all"
        style={{
          background: '#ffffff',
          border: '1.5px solid #3BB88A',
          boxShadow: '0 2px 6px rgba(59, 184, 138, 0.08)',
        }}
      >
        <textarea
          ref={inputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              reset();
              return;
            }
            if (e.key !== 'Enter' || e.shiftKey || isComposingRef.current || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void handleAdd();
          }}
          placeholder="比如：提醒我每晚读 10 分钟绘本"
          disabled={adding}
          rows={1}
          className={`todo-input-textarea block w-full resize-none border-0 bg-transparent py-1 text-[14px] leading-[1.55] outline-none placeholder:text-[#9ca3af] ${showScrollbar ? 'overflow-y-auto' : 'overflow-y-hidden'}`}
          style={{ color: '#1e293b' }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
          <TodoDueDatePicker value={newDueDate} onChange={setNewDueDate} />
          <TodoReminderPicker value={reminderOffsetMinutes} onChange={setReminderOffsetMinutes} />
          <TodoRecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} />
          <button
            type="button"
            title="添加"
            onClick={() => void handleAdd()}
            disabled={!canSubmit}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-all"
            style={{
              background: canSubmit ? '#3BB88A' : '#e5e7eb',
              color: canSubmit ? '#fff' : '#9ca3af',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? '0 2px 8px rgba(59, 184, 138, 0.28)' : 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function sortCustomTodos(todos: CustomTodoRow[]) {
  const pending = todos
    .filter((todo) => !todo.completedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const completed = todos
    .filter((todo) => todo.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));
  return { pending, completed };
}

export function CustomTodoInlineList({
  todos,
  onChanged,
  animatedTodoId,
}: {
  todos: CustomTodoRow[];
  onChanged: () => void;
  animatedTodoId: string | null;
}) {
  const handleToggle = useCallback(async (todo: CustomTodoRow) => {
    const now = isoNow();
    if (todo.completedAt) {
      await uncompleteCustomTodo(todo.todoId, now);
      onChanged();
      return;
    }
    const rule = parseRecurrenceRule(todo.recurrenceRule);
    if (rule) {
      const nextDueDate = computeNextDueDate(todo.dueDate, rule);
      await advanceCustomTodoDueDate({ todoId: todo.todoId, nextDueDate, now });
    } else {
      await completeCustomTodo(todo.todoId, now);
    }
    onChanged();
  }, [onChanged]);

  const handleDelete = useCallback(async (todoId: string) => {
    await deleteCustomTodo(todoId);
    onChanged();
  }, [onChanged]);

  const { pending, completed } = useMemo(() => sortCustomTodos(todos), [todos]);
  const { active: activeReminders, dismiss: dismissReminder, dismissAll: dismissAllReminders } =
    useCustomTodoReminders(todos);
  if (pending.length === 0 && completed.length === 0) return null;

  return (
    <div>
      {activeReminders.length > 0 && (
        <CustomTodoReminderBanner
          reminders={activeReminders}
          onDismiss={dismissReminder}
          onDismissAll={dismissAllReminders}
        />
      )}
      <div>
        {pending.map((todo) => {
          const isAnimated = animatedTodoId === todo.todoId;
          const rule = parseRecurrenceRule(todo.recurrenceRule);
          const reminderLabel = describeReminderOffset(todo.reminderOffsetMinutes);
          const recurrenceLabel = rule ? describeRecurrenceRule(rule) : '';
          const overdue = todo.dueDate && todo.dueDate < getLocalToday();
          return (
            <div
              key={todo.todoId}
              className={`group flex items-start gap-3 rounded-[12px] px-3 py-3.5 transition-colors hover:bg-white ${isAnimated ? 'custom-todo-slide-down' : ''}`}
            >
              <button
                type="button"
                title="标记完成"
                onClick={() => void handleToggle(todo)}
                className="mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-all hover:border-[#4ECCA3]"
                style={{ borderColor: '#D0D3D8' }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-medium leading-snug [overflow-wrap:anywhere]" style={{ color: '#1e293b' }}>{todo.title}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {todo.dueDate && (
                      <span className="text-[12px] group-hover:hidden" style={{ color: overdue ? '#ef4444' : '#64748b' }}>
                        {formatDueDate(todo.dueDate)}
                      </span>
                    )}
                    <button
                      type="button"
                      title="删除"
                      onClick={() => void handleDelete(todo.todoId)}
                      className="hidden h-[15px] w-[15px] items-center justify-center rounded-full transition-colors group-hover:flex hover:bg-[#f3f4f6]"
                      style={{ color: '#9aa0a7' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                {(recurrenceLabel || reminderLabel) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                    {recurrenceLabel && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px]"
                        style={{ color: '#3BB88A', background: 'rgba(59, 184, 138, 0.12)' }}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 1l4 4-4 4" />
                          <path d="M3 11V9a4 4 0 014-4h14" />
                          <path d="M7 23l-4-4 4-4" />
                          <path d="M21 13v2a4 4 0 01-4 4H3" />
                        </svg>
                        {recurrenceLabel}
                      </span>
                    )}
                    {reminderLabel && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px]"
                        style={{ color: '#F59E0B', background: 'rgba(245, 158, 11, 0.12)' }}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                        {reminderLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {completed.length > 0 && (
          <div className="pt-1">
            {completed.slice(0, 5).map((todo) => (
              <div
                key={todo.todoId}
                className="group flex items-start gap-3 rounded-[12px] px-3 py-3 transition-colors hover:bg-white"
              >
                <button
                  type="button"
                  title="取消完成"
                  onClick={() => void handleToggle(todo)}
                  className="mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: '#9aa0a7', background: '#9aa0a7' }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[14px] leading-snug line-through [overflow-wrap:anywhere]" style={{ color: '#9aa0a7' }}>{todo.title}</p>
                    <button
                      type="button"
                      title="删除"
                      onClick={() => void handleDelete(todo.todoId)}
                      className="hidden h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full transition-colors group-hover:flex hover:bg-[#f3f4f6]"
                      style={{ color: '#9aa0a7' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
