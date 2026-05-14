import { IconButton, cn } from '@nimiplatform/nimi-kit/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';
import { getCustomTodos } from '../../bridge/sqlite-bridge.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  CustomTodoComposer,
  CustomTodoInlineList,
} from '../timeline/timeline-custom-todos.js';

const DRAWER_WIDTH = 360;

export function ProfileTodoDrawer() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((entry) => entry.childId === activeChildId) ?? null;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [todos, setTodos] = useState<CustomTodoRow[]>([]);
  const [optimisticTodo, setOptimisticTodo] = useState<CustomTodoRow | null>(null);
  const [animatedTodoId, setAnimatedTodoId] = useState<string | null>(null);

  const todoList = useMemo(() => {
    if (!optimisticTodo) return todos;
    if (todos.some((todo) => todo.todoId === optimisticTodo.todoId)) return todos;
    return [optimisticTodo, ...todos];
  }, [todos, optimisticTodo]);

  const pendingCount = useMemo(
    () => todoList.filter((todo) => !todo.completedAt).length,
    [todoList],
  );

  const loadTodos = useCallback(async () => {
    if (!activeChildId) {
      setTodos([]);
      return;
    }
    try {
      const next = await getCustomTodos(activeChildId);
      setTodos(next);
    } catch (error) {
      catchLog('profile', 'action:load-custom-todos-failed')(error);
    }
  }, [activeChildId]);

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  useEffect(() => {
    if (!optimisticTodo) return;
    if (!todos.some((todo) => todo.todoId === optimisticTodo.todoId)) return;
    setOptimisticTodo(null);
  }, [todos, optimisticTodo]);

  useEffect(() => {
    if (!animatedTodoId) return;
    const timer = window.setTimeout(() => setAnimatedTodoId(null), 420);
    return () => window.clearTimeout(timer);
  }, [animatedTodoId]);

  useEffect(() => {
    if (!open) return;
    void loadTodos();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, loadTodos]);

  const openDrawer = () => {
    setMounted(true);
    requestAnimationFrame(() => setOpen(true));
  };

  const closeDrawer = () => {
    setOpen(false);
  };

  if (!activeChildId || !child) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? closeDrawer() : openDrawer())}
        aria-label="打开待办事项"
        title="待办事项"
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-floating)] transition-all hover:-translate-y-0.5"
      >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        {pendingCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[var(--nimi-surface-card)] bg-[var(--nimi-status-success)] px-1 text-[12px] font-bold text-[var(--nimi-action-primary-text)]"
          >
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        ) : null}
      </button>

      {mounted ? (
        <>
          <div
            onClick={closeDrawer}
            aria-hidden
            className={cn(
              'fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--nimi-text-primary)_22%,transparent)] transition-opacity duration-200',
              open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            )}
          />
          <aside
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              if (!open) setMounted(false);
            }}
            className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-floating)]"
            style={{
              transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
              transition: 'transform 0.22s ease',
            }}
          >
            <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
                  待办事项
                </h2>
                <p className="mt-0.5 text-[13px] text-[var(--nimi-text-muted)]">
                  {child.displayName} · {pendingCount > 0 ? `${pendingCount} 条未完成` : '全部已完成'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/reminders"
                  onClick={closeDrawer}
                  className="text-[13px] font-medium transition-colors hover:underline text-[var(--nimi-text-muted)]"
                >
                  查看全部
                </Link>
                <IconButton
                  tone="ghost"
                  size="sm"
                  onClick={closeDrawer}
                  aria-label="关闭"
                  className="h-7 w-7 rounded-lg text-[var(--nimi-text-muted)]"
                  icon={(
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  )}
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4">
              <div className="mb-2 px-1">
                <CustomTodoComposer
                  childId={child.childId}
                  onChanged={() => { void loadTodos(); }}
                  onAdded={(todo) => {
                    setOptimisticTodo(todo);
                    setAnimatedTodoId(todo.todoId);
                  }}
                />
                {todoList.length === 0 ? (
                  <p className="px-6 py-10 text-center text-[14px] text-[var(--nimi-text-muted)]">
                    还没有待办，添加一条开始吧
                  </p>
                ) : (
                  <CustomTodoInlineList
                    todos={todoList}
                    onChanged={() => { void loadTodos(); }}
                    animatedTodoId={animatedTodoId}
                  />
                )}
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
