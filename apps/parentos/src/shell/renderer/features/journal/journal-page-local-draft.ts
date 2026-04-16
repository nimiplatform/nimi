import type { KeepsakeReason } from './journal-page-helpers.js';

export type JournalLocalDraftPayload = {
  version: 1;
  childId: string;
  textContent: string;
  selectedDimension: string | null;
  selectedTags: string[];
  selectedRecorderId: string | null;
  keepsake: boolean;
  keepsakeTitle: string;
  keepsakeReason: KeepsakeReason | null;
  moodTag: string | null;
  subjectiveNotes: string;
};

export type JournalLocalDraftRecord = JournalLocalDraftPayload & {
  updatedAt: string;
};

const JOURNAL_LOCAL_DRAFT_PREFIX = 'parentos:journal-draft:';
const DRAFT_AUTO_RESTORE_AGE_MS = 5 * 60 * 1000;

export const KEEPSAKE_KEYWORDS = ['第一次', '获奖', '完成', '通过', '读完', '坚持'];

function buildJournalLocalDraftKey(childId: string) {
  return `${JOURNAL_LOCAL_DRAFT_PREFIX}${childId}`;
}

export function serializeJournalLocalDraft(payload: JournalLocalDraftPayload) {
  return JSON.stringify(payload);
}

export function toJournalLocalDraftPayload(record: JournalLocalDraftRecord): JournalLocalDraftPayload {
  return {
    version: 1,
    childId: record.childId,
    textContent: record.textContent,
    selectedDimension: record.selectedDimension,
    selectedTags: record.selectedTags,
    selectedRecorderId: record.selectedRecorderId,
    keepsake: record.keepsake,
    keepsakeTitle: record.keepsakeTitle,
    keepsakeReason: record.keepsakeReason,
    moodTag: record.moodTag,
    subjectiveNotes: record.subjectiveNotes,
  };
}

export function hasMeaningfulJournalLocalDraft(payload: JournalLocalDraftPayload) {
  return payload.textContent.trim().length > 0
    || payload.selectedDimension !== null
    || payload.selectedTags.length > 0
    || payload.keepsake
    || payload.keepsakeTitle.trim().length > 0
    || payload.keepsakeReason !== null
    || payload.moodTag !== null
    || payload.subjectiveNotes.trim().length > 0;
}

export function readJournalLocalDraft(childId: string): JournalLocalDraftRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(buildJournalLocalDraftKey(childId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JournalLocalDraftRecord>;
    if (parsed.version !== 1 || parsed.childId !== childId) return null;
    return {
      version: 1,
      childId,
      textContent: typeof parsed.textContent === 'string' ? parsed.textContent : '',
      selectedDimension: typeof parsed.selectedDimension === 'string' ? parsed.selectedDimension : null,
      selectedTags: Array.isArray(parsed.selectedTags) ? parsed.selectedTags.map((tag) => String(tag)) : [],
      selectedRecorderId: typeof parsed.selectedRecorderId === 'string' ? parsed.selectedRecorderId : null,
      keepsake: parsed.keepsake === true,
      keepsakeTitle: typeof parsed.keepsakeTitle === 'string' ? parsed.keepsakeTitle : '',
      keepsakeReason: typeof parsed.keepsakeReason === 'string' ? parsed.keepsakeReason as KeepsakeReason : null,
      moodTag: typeof parsed.moodTag === 'string' ? parsed.moodTag : null,
      subjectiveNotes: typeof parsed.subjectiveNotes === 'string' ? parsed.subjectiveNotes : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function writeJournalLocalDraft(record: JournalLocalDraftRecord) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(buildJournalLocalDraftKey(record.childId), JSON.stringify(record));
  } catch {
    /* local storage unavailable */
  }
}

export function clearJournalLocalDraft(childId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(buildJournalLocalDraftKey(childId));
  } catch {
    /* local storage unavailable */
  }
}

export function formatJournalDraftTime(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function isRecentJournalDraft(updatedAt: string): boolean {
  if (!updatedAt) return false;
  const savedTime = new Date(updatedAt).getTime();
  if (Number.isNaN(savedTime)) return false;
  return Date.now() - savedTime < DRAFT_AUTO_RESTORE_AGE_MS;
}
