import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';
import { getCustomTodos } from '../../bridge/sqlite-bridge.js';
import type { CustomTodoRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  CustomTodoComposer,
  CustomTodoInlineList,
} from '../timeline/timeline-page-panels.js';

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
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full transition-all hover:-translate-y-0.5"
        style={{
          background: '#1e293b',
          color: '#ffffff',
          boxShadow: '0 10px 24px rgba(15,23,42,0.18)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        {pendingCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: '#4ECCA3', color: '#ffffff', border: '2px solid #ffffff' }}
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
            className="fixed inset-0 z-40"
            style={{
              background: 'rgba(15,23,42,0.22)',
              opacity: open ? 1 : 0,
              transition: 'opacity 0.2s ease',
              pointerEvents: open ? 'auto' : 'none',
            }}
          />
          <aside
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              if (!open) setMounted(false);
            }}
            className="fixed right-0 top-0 z-50 flex h-full flex-col"
            style={{
              width: DRAWER_WIDTH,
              background: '#ffffff',
              boxShadow: '-18px 0 48px rgba(15,23,42,0.12)',
              transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
              transition: 'transform 0.22s ease',
            }}
          >
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: '#eceae4' }}>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>
                  待办事项
                </h2>
                <p className="mt-0.5 text-[11px]" style={{ color: '#64748b' }}>
                  {child.displayName} · {pendingCount > 0 ? `${pendingCount} 条未完成` : '全部已完成'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/reminders"
                  onClick={closeDrawer}
                  className="text-[11px] font-medium transition-colors hover:underline"
                  style={{ color: '#475569' }}
                >
                  查看全部
                </Link>
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label="关闭"
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[#f0f0ec]"
                  style={{ color: '#b0b5bc' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
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
                  <p className="px-6 py-10 text-center text-[12px]" style={{ color: '#9CA0A6' }}>
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
