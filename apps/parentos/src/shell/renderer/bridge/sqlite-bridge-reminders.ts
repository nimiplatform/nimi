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
  // v10 per-kind progression columns (reminder-interaction-contract.md#PO-REMI-004)
  acknowledgedAt: string | null;
  reflectedAt: string | null;
  practiceStartedAt: string | null;
  practiceLastAt: string | null;
  practiceCount: number;
  practiceHabituatedAt: string | null;
  consultedAt: string | null;
  consultationConversationId: string | null;
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
  // v10 progression columns — each writer is responsible for honoring the kind-scoped
  // write rules in PO-REMI-004. The bridge accepts them as optionals and fills null
  // for callers that only touch the non-progression columns.
  acknowledgedAt?: string | null;
  reflectedAt?: string | null;
  practiceStartedAt?: string | null;
  practiceLastAt?: string | null;
  practiceCount?: number;
  practiceHabituatedAt?: string | null;
  consultedAt?: string | null;
  consultationConversationId?: string | null;
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
    acknowledgedAt: params.acknowledgedAt ?? null,
    reflectedAt: params.reflectedAt ?? null,
    practiceStartedAt: params.practiceStartedAt ?? null,
    practiceLastAt: params.practiceLastAt ?? null,
    practiceCount: params.practiceCount ?? 0,
    practiceHabituatedAt: params.practiceHabituatedAt ?? null,
    consultedAt: params.consultedAt ?? null,
    consultationConversationId: params.consultationConversationId ?? null,
  });
}

export function getReminderStates(childId: string) {
  return invoke<ReminderStateRow[]>('get_reminder_states', { childId });
}

export function getActiveReminders(childId: string) {
  return invoke<ReminderStateRow[]>('get_active_reminders', { childId });
}

/**
 * PO-REMI-007 advisor writeback. The advisor module calls this on the first
 * persisted assistant message for a reminder-anchored conversation.
 * First write wins; subsequent calls for the same target are no-ops.
 * Fails-close if no matching reminder_states row exists.
 */
export function upsertReminderConsultation(params: {
  childId: string;
  ruleId: string;
  repeatIndex: number;
  conversationId: string;
  now: string;
}) {
  return invoke<void>('upsert_reminder_consultation', params);
}

/**
 * PO-REMI-007 cascade: clears consultedAt + consultationConversationId on any
 * reminder_states row anchored to the deleted conversation. Advisor must call
 * this before dropping the conversation row to keep the consult lifecycle honest.
 */
export function clearReminderConsultation(params: {
  childId: string;
  conversationId: string;
  now: string;
}) {
  return invoke<void>('clear_reminder_consultation', params);
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
