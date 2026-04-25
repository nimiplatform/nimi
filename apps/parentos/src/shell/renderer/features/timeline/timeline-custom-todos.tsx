import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
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
import { ProfileDatePicker } from '../profile/profile-date-picker.js';
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerOpenNonce, setDatePickerOpenNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<TodoRecurrenceRule | null>(null);
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [newTitle]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const reset = useCallback(() => {
    setNewTitle('');
    setNewDueDate('');
    setShowDatePicker(false);
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

  const dateFieldClassName = `w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#C2E8F7]/50`;
  const dateFieldStyle = {
    borderColor: S.border,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    background: '#fafaf8',
  };

  const canSubmit = newTitle.trim().length > 0 && !adding;
  const dateActive = showDatePicker || Boolean(newDueDate);

  if (!expanded) {
    return (
      <div className="px-5 pb-3 pt-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[#d4d4d1] bg-[#fafaf8] px-3.5 py-3 transition-all hover:border-[#3BB88A] hover:bg-[rgba(59,184,138,0.04)] hover:shadow-[0_8px_22px_rgba(59,184,138,0.14)]"
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white transition-transform group-hover:scale-105"
            style={{ background: '#3BB88A', boxShadow: '0 2px 6px rgba(59, 184, 138, 0.28)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-[13px] transition-colors group-hover:text-[#3BB88A]" style={{ color: '#9ca3af' }}>添加日常待办...</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pb-3 pt-3">
      <div
        className="rounded-2xl px-4 pb-3 pt-3.5 transition-all"
        style={{
          background: '#ffffff',
          border: '1.5px solid #3BB88A',
          boxShadow: '0 8px 22px rgba(59, 184, 138, 0.14)',
        }}
      >
        <div className="mb-1 text-[14px] font-semibold" style={{ color: '#111827' }}>要做什么？</div>
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
          className="block w-full resize-none overflow-y-auto border-0 bg-transparent py-1 text-[13px] leading-[1.55] outline-none placeholder:text-[#9ca3af]"
          style={{ color: '#1e293b' }}
        />

        <div className="my-2.5 h-px" style={{ background: '#eef0ee' }} />

        <div className="flex items-center gap-1">
          <button
            type="button"
            title={showDatePicker ? '收起日期' : newDueDate ? '修改日期' : '设置日期'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (showDatePicker) {
                setShowDatePicker(false);
                return;
              }
              setShowDatePicker(true);
              setDatePickerOpenNonce((value) => value + 1);
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3.5 text-[12px] font-medium transition-colors"
            style={{
              color: dateActive ? '#ffffff' : '#64748b',
              background: dateActive ? '#3BB88A' : 'transparent',
              border: 'none',
              boxShadow: dateActive ? '0 2px 8px rgba(59, 184, 138, 0.28)' : 'none',
            }}
          >
            <span>{newDueDate ? formatDueDate(newDueDate) : '今天'}</span>
          </button>
          <TodoReminderPicker value={reminderOffsetMinutes} onChange={setReminderOffsetMinutes} />
          <TodoRecurrencePicker value={recurrenceRule} onChange={setRecurrenceRule} />
        </div>

        {showDatePicker && (
          <div className="mt-2">
            <ProfileDatePicker
              value={newDueDate}
              onChange={setNewDueDate}
              allowClear
              maxDate="2100-12-31"
              autoOpenNonce={datePickerOpenNonce}
              className={dateFieldClassName}
              style={dateFieldStyle}
            />
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-8 rounded-full px-4 text-[13px] font-medium transition-colors hover:bg-[#f3f4f6]"
            style={{ color: '#64748b', background: 'transparent' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!canSubmit}
            className="h-8 rounded-full px-5 text-[13px] font-medium transition-all"
            style={{
              background: canSubmit ? '#3BB88A' : '#e5e7eb',
              color: canSubmit ? '#fff' : '#9ca3af',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? '0 2px 8px rgba(59, 184, 138, 0.28)' : 'none',
            }}
          >
            添加
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
    <div className="px-3 pb-1">
      {activeReminders.length > 0 && (
        <CustomTodoReminderBanner
          reminders={activeReminders}
          onDismiss={dismissReminder}
          onDismissAll={dismissAllReminders}
        />
      )}
      <div className="space-y-1.5">
        {pending.map((todo) => {
          const isAnimated = animatedTodoId === todo.todoId;
          const rule = parseRecurrenceRule(todo.recurrenceRule);
          const reminderLabel = describeReminderOffset(todo.reminderOffsetMinutes);
          const recurrenceLabel = rule ? describeRecurrenceRule(rule) : '';
          return (
            <div
              key={todo.todoId}
              className={`group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-all hover:bg-[#edf4ff] ${isAnimated ? 'custom-todo-slide-down' : ''}`}
              style={{ background: '#f6f9ff' }}
            >
              <button
                type="button"
                title="标记完成"
                onClick={() => void handleToggle(todo)}
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-[#7ba7ff]/15"
                style={{ borderColor: '#7ba7ff' }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#7ba7ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition-opacity group-hover:opacity-100">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium leading-snug [overflow-wrap:anywhere]" style={{ color: '#38506f' }}>{todo.title}</p>
                {(todo.dueDate || reminderLabel || recurrenceLabel) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {todo.dueDate && (
                      <span style={{ color: todo.dueDate < getLocalToday() ? '#ef4444' : '#8aa1bc' }}>
                        {formatDueDate(todo.dueDate)}
                      </span>
                    )}
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
              <button
                type="button"
                title="删除"
                onClick={() => void handleDelete(todo.todoId)}
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: '#8aa1bc' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        {completed.length > 0 && (
          <div className="pt-1">
            {completed.slice(0, 5).map((todo) => (
              <div
                key={todo.todoId}
                className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#f2f6ff]"
              >
                <button
                  type="button"
                  title="取消完成"
                  onClick={() => void handleToggle(todo)}
                  className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]"
                  style={{ borderColor: '#7ba7ff', background: '#7ba7ff' }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-snug line-through [overflow-wrap:anywhere]" style={{ color: '#9fb0c8' }}>{todo.title}</p>
                </div>
                <button
                  type="button"
                  title="删除"
                  onClick={() => void handleDelete(todo.todoId)}
                  className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: '#9fb0c8' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
