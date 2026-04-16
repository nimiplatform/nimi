import { invoke } from '@tauri-apps/api/core';

export interface ReminderStateRow {
  stateId: string;
  childId: string;
  ruleId: string;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  notApplicable: number;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function upsertReminderState(params: {
  stateId: string;
  childId: string;
  ruleId: string;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil?: string | null;
  scheduledDate?: string | null;
  notApplicable?: number;
  plannedForDate?: string | null;
  surfaceRank?: number | null;
  lastSurfacedAt?: string | null;
  surfaceCount?: number;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('upsert_reminder_state', {
    ...params,
    snoozedUntil: params.snoozedUntil ?? null,
    scheduledDate: params.scheduledDate ?? null,
    notApplicable: params.notApplicable ?? 0,
    plannedForDate: params.plannedForDate ?? null,
    surfaceRank: params.surfaceRank ?? null,
    lastSurfacedAt: params.lastSurfacedAt ?? null,
    surfaceCount: params.surfaceCount ?? 0,
  });
}

export function getReminderStates(childId: string) {
  return invoke<ReminderStateRow[]>('get_reminder_states', { childId });
}

export function getActiveReminders(childId: string) {
  return invoke<ReminderStateRow[]>('get_active_reminders', { childId });
}

export interface CustomTodoRow {
  todoId: string;
  childId: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertCustomTodo(params: {
  todoId: string;
  childId: string;
  title: string;
  dueDate: string | null;
  now: string;
}) {
  return invoke<void>('insert_custom_todo', params);
}

export function updateCustomTodo(params: {
  todoId: string;
  title: string;
  dueDate: string | null;
  now: string;
}) {
  return invoke<void>('update_custom_todo', params);
}

export function completeCustomTodo(todoId: string, now: string) {
  return invoke<void>('complete_custom_todo', { todoId, now });
}

export function uncompleteCustomTodo(todoId: string, now: string) {
  return invoke<void>('uncomplete_custom_todo', { todoId, now });
}

export function deleteCustomTodo(todoId: string) {
  return invoke<void>('delete_custom_todo', { todoId });
}

export function getCustomTodos(childId: string) {
  return invoke<CustomTodoRow[]>('get_custom_todos', { childId });
}
