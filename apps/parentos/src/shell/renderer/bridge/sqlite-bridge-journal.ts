import { invoke } from '@tauri-apps/api/core';
import type { KeepsakeReason } from '../features/journal/journal-page-helpers.js';

export interface JournalEntryRow {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  keepsakeTitle?: string | null;
  keepsakeReason?: KeepsakeReason | null;
  moodTag: string | null;
  recorderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertJournalEntry(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  keepsakeTitle?: string | null;
  keepsakeReason?: KeepsakeReason | null;
  moodTag: string | null;
  recorderId: string | null;
  now: string;
}) {
  return invoke<void>('insert_journal_entry', {
    ...params,
    keepsakeTitle: params.keepsakeTitle ?? null,
    keepsakeReason: params.keepsakeReason ?? null,
  });
}

export interface JournalTagInsertRow {
  tagId: string;
  domain: string;
  tag: string;
  source: string;
  confidence: number | null;
}

export function insertJournalEntryWithTags(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  keepsakeTitle?: string | null;
  keepsakeReason?: KeepsakeReason | null;
  moodTag: string | null;
  recorderId: string | null;
  aiTags: JournalTagInsertRow[];
  now: string;
}) {
  return invoke<void>('insert_journal_entry_with_tags', {
    ...params,
    keepsakeTitle: params.keepsakeTitle ?? null,
    keepsakeReason: params.keepsakeReason ?? null,
  });
}

export function updateJournalEntryWithTags(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  keepsakeTitle?: string | null;
  keepsakeReason?: KeepsakeReason | null;
  moodTag: string | null;
  recorderId: string | null;
  aiTags: JournalTagInsertRow[];
  now: string;
}) {
  return invoke<void>('update_journal_entry_with_tags', {
    ...params,
    keepsakeTitle: params.keepsakeTitle ?? null,
    keepsakeReason: params.keepsakeReason ?? null,
  });
}

export function getJournalEntries(childId: string, limit?: number) {
  return invoke<JournalEntryRow[]>('get_journal_entries', { childId, limit: limit ?? null });
}

export function insertJournalTag(params: {
  tagId: string;
  entryId: string;
  domain: string;
  tag: string;
  source: string;
  confidence: number | null;
  now: string;
}) {
  return invoke<void>('insert_journal_tag', params);
}

export function getJournalTags(entryId: string) {
  return invoke<Array<{
    tagId: string;
    entryId: string;
    domain: string;
    tag: string;
    source: string;
    confidence: number | null;
    createdAt: string;
  }>>('get_journal_tags', { entryId });
}

export function updateJournalKeepsake(
  entryId: string,
  keepsake: 0 | 1,
  now: string,
  keepsakeTitle?: string | null,
  keepsakeReason?: KeepsakeReason | null,
) {
  return invoke<void>('update_journal_keepsake', {
    entryId,
    keepsake,
    now,
    keepsakeTitle: keepsakeTitle ?? null,
    keepsakeReason: keepsakeReason ?? null,
  });
}

export function deleteJournalEntry(entryId: string) {
  return invoke<void>('delete_journal_entry', { entryId });
}
