import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { getLocalToday } from '../../engine/reminder-engine.js';
import {
  completeCustomTodo,
  deleteCustomTodo,
  insertCustomTodo,
  uncompleteCustomTodo,
} from '../../bridge/sqlite-bridge.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { ProfileDatePicker } from '../profile/profile-date-picker.js';

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
  }, []);

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const now = isoNow();
    const todoId = ulid();
    const optimisticTodo: CustomTodoRow = {
      todoId,
      childId,
      title,
      dueDate: newDueDate || null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    setAdding(true);
    try {
      await insertCustomTodo({ todoId, childId, title, dueDate: newDueDate || null, now });
      onAdded(optimisticTodo);
      onChanged();
      setNewTitle('');
      setNewDueDate('');
      setShowDatePicker(false);
      setExpanded(false);
    } catch (error) {
      catchLog('timeline', 'action:add-custom-todo-failed')(error);
    } finally {
      setAdding(false);
    }
  }, [newTitle, newDueDate, childId, onAdded, onChanged]);

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
          className="group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 transition-all hover:bg-white"
          style={{
            background: '#fafaf8',
            border: '1.5px dashed #d4d4d1',
          }}
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white transition-transform group-hover:scale-105"
            style={{ background: '#3BB88A', boxShadow: '0 2px 6px rgba(59, 184, 138, 0.28)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-[13px]" style={{ color: '#9ca3af' }}>添加日常待办...</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pb-3 pt-3">
      <div
        className="rounded-2xl px-3.5 pt-3 pb-2.5 transition-all"
        style={{
          background: 'rgba(78, 204, 163, 0.04)',
          border: '1.5px solid #3BB88A',
          boxShadow: '0 8px 22px rgba(78, 204, 163, 0.14)',
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
          className="block w-full resize-none overflow-y-auto border-0 bg-transparent py-1 text-[13px] leading-[1.55] outline-none placeholder:text-[#9ca3af]"
          style={{ color: '#1e293b' }}
        />

        <div className="mt-2 flex items-center gap-1.5">
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
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-all"
            style={{
              color: dateActive ? '#3BB88A' : '#64748b',
              background: dateActive ? 'rgba(78, 204, 163, 0.14)' : '#fff',
              border: `1px solid ${dateActive ? 'rgba(78, 204, 163, 0.42)' : '#e5e7eb'}`,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span>{newDueDate ? formatDueDate(newDueDate) : '今天'}</span>
          </button>
          <button
            type="button"
            title="即将支持"
            disabled
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium"
            style={{
              color: '#9ca3af',
              background: '#fff',
              border: '1px solid #e5e7eb',
              cursor: 'not-allowed',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>加提醒</span>
          </button>
          <button
            type="button"
            title="即将支持"
            disabled
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium"
            style={{
              color: '#9ca3af',
              background: '#fff',
              border: '1px solid #e5e7eb',
              cursor: 'not-allowed',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            <span>重复</span>
          </button>
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

        <div className="mt-2.5 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={reset}
            className="h-7 rounded-full px-3 text-[12px] font-medium transition-colors hover:bg-white/60"
            style={{ color: '#64748b' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!canSubmit}
            className="h-7 rounded-full px-4 text-[12px] font-medium transition-all"
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
    if (todo.completedAt) {
      await uncompleteCustomTodo(todo.todoId, isoNow());
    } else {
      await completeCustomTodo(todo.todoId, isoNow());
    }
    onChanged();
  }, [onChanged]);

  const handleDelete = useCallback(async (todoId: string) => {
    await deleteCustomTodo(todoId);
    onChanged();
  }, [onChanged]);

  const { pending, completed } = useMemo(() => sortCustomTodos(todos), [todos]);
  if (pending.length === 0 && completed.length === 0) return null;

  return (
    <div className="px-3 pb-1">
      <div className="space-y-1.5">
        {pending.map((todo) => {
          const isAnimated = animatedTodoId === todo.todoId;
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
                {todo.dueDate && (
                  <p className="mt-0.5 text-[10px]" style={{ color: todo.dueDate < getLocalToday() ? '#ef4444' : '#8aa1bc' }}>
                    {formatDueDate(todo.dueDate)}
                  </p>
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
