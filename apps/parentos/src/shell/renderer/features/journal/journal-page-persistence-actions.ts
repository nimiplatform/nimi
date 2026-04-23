import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  deleteJournalEntry,
  insertCustomTodo,
  insertJournalEntryWithTags,
  updateJournalEntryWithTags,
  updateJournalKeepsake,
  type JournalEntryRow,
  type JournalTagInsertRow,
} from '../../bridge/sqlite-bridge.js';
import { deleteJournalVoiceAudio, saveJournalVoiceAudio } from '../../bridge/journal-audio-bridge.js';
import { deleteJournalPhoto, saveJournalPhoto } from '../../bridge/journal-photo-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  startVoiceRecording,
  type VoiceRecordingSession,
} from './voice-observation-recorder.js';
import { transcribeVoiceObservation } from './voice-observation-runtime.js';
import { resolveVoiceObservationPayload } from './voice-observation.js';
import {
  EMPTY_VOICE_DRAFT,
  blobToBase64,
  fileToBase64,
  parseSelectedTags,
  type KeepsakeReason,
  type PhotoDraft,
  type VoiceDraft,
} from './journal-page-helpers.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { completeReminderByRule } from '../../engine/reminder-actions.js';
import { getExperimentSuggestion, type ExperimentTemplate } from './journal-experiment-templates.js';
import { clearJournalLocalDraft, type JournalLocalDraftRecord } from './journal-page-local-draft.js';

type SetOptionalString = Dispatch<SetStateAction<string | null>>;
type SetOptionalEntry = Dispatch<SetStateAction<JournalEntryRow | null>>;
type SetVoiceDraft = Dispatch<SetStateAction<VoiceDraft>>;

export function createJournalPersistenceActions(input: {
  childId: string;
  ageMonths: number;
  activeMode: string;
  selectedDimension: string | null;
  selectedTags: string[];
  subjectiveNotes: string;
  keepsake: boolean;
  keepsakeTitle: string;
  keepsakeReason: KeepsakeReason | null;
  suggestsKeepsake: boolean;
  moodTag: string | null;
  selectedRecorderId: string | null;
  editingEntryId: string | null;
  editingEntry: JournalEntryRow | null;
  captureMode: 'text' | 'voice';
  textContent: string;
  voiceDraft: VoiceDraft;
  photoDrafts: PhotoDraft[];
  searchParams: URLSearchParams;
  recorderSessionRef: MutableRefObject<VoiceRecordingSession | null>;
  skipLocalDraftPersistRef: MutableRefObject<boolean>;
  setSubmitError: SetOptionalString;
  setSaving: (value: boolean) => void;
  setAddingTodo: (value: boolean) => void;
  setDeleting: (value: boolean) => void;
  setDeleteTarget: SetOptionalEntry;
  setPendingKeepsakePromptEntry: SetOptionalEntry;
  setPromptKeepsakeTitle: (value: string) => void;
  setPromptKeepsakeReason: (value: KeepsakeReason | null) => void;
  setPromptKeepsakeMode: (value: 'enrich' | 'confirm') => void;
  setSavingKeepsakePrompt: (value: boolean) => void;
  setPostSaveExperiment: Dispatch<SetStateAction<ExperimentTemplate | null>>;
  setRestorableDraft: Dispatch<SetStateAction<JournalLocalDraftRecord | null>>;
  setLastAutosavedAt: SetOptionalString;
  setLastSavedDraftSignature: SetOptionalString;
  setVoiceDraft: SetVoiceDraft;
  reloadEntries: () => Promise<void>;
  resetComposer: () => void;
  clearReminderSearchParams: () => void;
  closeKeepsakePrompt: () => void;
  clearVoiceDraft: () => void;
  deleteTarget: JournalEntryRow | null;
  pendingKeepsakePromptEntry: JournalEntryRow | null;
  promptKeepsakeTitle: string;
  promptKeepsakeReason: KeepsakeReason | null;
  postSaveExperiment: ExperimentTemplate | null;
}) {
  const persistPhotos = async (entryId: string): Promise<string | null> => {
    if (input.photoDrafts.length === 0) {
      return null;
    }
    const savedPaths: string[] = [];
    for (let i = 0; i < input.photoDrafts.length; i += 1) {
      const draft = input.photoDrafts[i]!;
      const base64 = await fileToBase64(draft.file);
      const result = await saveJournalPhoto({
        childId: input.childId,
        entryId,
        index: i,
        mimeType: draft.file.type,
        imageBase64: base64,
      });
      savedPaths.push(result.path);
    }
    return JSON.stringify(savedPaths);
  };

  const rollbackPhotos = async (photoPaths: string | null) => {
    if (!photoPaths) {
      return;
    }
    try {
      const paths = JSON.parse(photoPaths) as string[];
      for (const path of paths) {
        await deleteJournalPhoto(path).catch(catchLog('journal', 'action:rollback-delete-photo-failed', 'warn'));
      }
    } catch {
      /* ignore invalid photo path json */
    }
  };

  const saveJournalEntry = async (payload: {
    entryId: string;
    contentType: string;
    textContent: string | null;
    voicePath: string | null;
    photoPaths: string | null;
    recordedAt: string;
    now: string;
    aiTags: JournalTagInsertRow[];
  }) => {
    const params = {
      entryId: payload.entryId,
      childId: input.childId,
      contentType: payload.contentType,
      textContent: payload.textContent,
      voicePath: payload.voicePath,
      photoPaths: payload.photoPaths,
      recordedAt: payload.recordedAt,
      ageMonths: input.ageMonths,
      observationMode: input.activeMode,
      dimensionId: input.selectedDimension,
      selectedTags: input.selectedTags.length > 0 ? JSON.stringify(input.selectedTags) : null,
      guidedAnswers: input.subjectiveNotes.trim()
        ? JSON.stringify({ _subjective: input.subjectiveNotes.trim() })
        : null,
      observationDuration: null,
      keepsake: input.keepsake ? 1 : 0,
      moodTag: input.moodTag,
      recorderId: input.selectedRecorderId,
      keepsakeTitle: input.keepsake ? input.keepsakeTitle.trim() || null : null,
      keepsakeReason: input.keepsake ? input.keepsakeReason : null,
      aiTags: payload.aiTags,
      now: payload.now,
    };
    if (input.editingEntryId) {
      await updateJournalEntryWithTags(params);
      return;
    }
    await insertJournalEntryWithTags(params);
  };

  const mergePhotoPathJson = (existing: string | null, added: string | null) => {
    const merged: string[] = [];
    for (const raw of [existing, added]) {
      if (!raw) {
        continue;
      }
      try {
        for (const path of JSON.parse(raw) as string[]) {
          if (!merged.includes(path)) {
            merged.push(path);
          }
        }
      } catch {
        /* ignore invalid photo path json */
      }
    }
    return merged.length > 0 ? JSON.stringify(merged) : null;
  };

  const handleToggleKeepsake = async (entry: JournalEntryRow) => {
    try {
      const nextKeepsake = entry.keepsake === 1 ? 0 : 1;
      await updateJournalKeepsake(entry.entryId, nextKeepsake, isoNow());
      await input.reloadEntries();
      if (nextKeepsake === 1 && !entry.keepsakeTitle && !entry.keepsakeReason) {
        input.setPromptKeepsakeTitle('');
        input.setPromptKeepsakeReason(null);
        input.setPromptKeepsakeMode('enrich');
        input.setPendingKeepsakePromptEntry({ ...entry, keepsake: 1 });
        return;
      }
      input.closeKeepsakePrompt();
    } catch {
      /* bridge unavailable */
    }
  };

  const handleSaveKeepsakePrompt = async () => {
    if (!input.pendingKeepsakePromptEntry) {
      return;
    }
    input.setSavingKeepsakePrompt(true);
    try {
      await updateJournalKeepsake(
        input.pendingKeepsakePromptEntry.entryId,
        1,
        isoNow(),
        input.promptKeepsakeTitle.trim() || null,
        input.promptKeepsakeReason,
      );
      await input.reloadEntries();
      input.closeKeepsakePrompt();
    } catch {
      input.setSavingKeepsakePrompt(false);
    }
  };

  const handleAddExperimentTodo = async () => {
    if (!input.postSaveExperiment) {
      return;
    }
    input.setAddingTodo(true);
    try {
      await insertCustomTodo({
        todoId: ulid(),
        childId: input.childId,
        title: input.postSaveExperiment.title,
        dueDate: null,
        now: isoNow(),
      });
      input.setPostSaveExperiment(null);
    } catch {
      /* non-critical */
    } finally {
      input.setAddingTodo(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!input.deleteTarget) {
      return;
    }
    input.setSubmitError(null);
    input.setDeleting(true);
    try {
      await deleteJournalEntry(input.deleteTarget.entryId);
      if (input.deleteTarget.voicePath) {
        await deleteJournalVoiceAudio(input.deleteTarget.voicePath).catch(catchLog('journal', 'action:cleanup-delete-voice-failed', 'warn'));
      }
      for (const photoPath of parseSelectedTags(input.deleteTarget.photoPaths)) {
        await deleteJournalPhoto(photoPath).catch(catchLog('journal', 'action:cleanup-delete-photo-failed', 'warn'));
      }
      if (input.editingEntryId === input.deleteTarget.entryId) {
        input.resetComposer();
      }
      input.setDeleteTarget(null);
      await input.reloadEntries();
    } catch {
      input.setSubmitError('删除失败，请稍后重试。');
    } finally {
      input.setDeleting(false);
    }
  };

  const handleSubmit = async (aiTags?: JournalTagInsertRow[]) => {
    const now = isoNow();
    input.setSubmitError(null);
    input.setSaving(true);

    const savedKeepsake = input.keepsake;
    const savedKeepsakeTitle = input.keepsakeTitle.trim();
    const savedKeepsakeReason = input.keepsakeReason;
    const savedSuggestsKeepsake = input.suggestsKeepsake;

    try {
      const entryId = input.editingEntryId ?? ulid();
      let savedPhotoPaths: string | null = null;

      try {
        savedPhotoPaths = await persistPhotos(entryId);
        const mergedPhotoPaths = mergePhotoPathJson(input.editingEntry?.photoPaths ?? null, savedPhotoPaths);
        const preservedVoicePath = input.editingEntry?.voicePath ?? null;
        const recordedAt = input.editingEntry?.recordedAt ?? now;

        if (input.captureMode === 'text') {
          if (!input.textContent.trim() && !mergedPhotoPaths && !preservedVoicePath) {
            input.setSaving(false);
            return;
          }
          const contentType = preservedVoicePath
            ? (input.textContent.trim() ? 'mixed' : 'voice')
            : (mergedPhotoPaths && !input.textContent.trim() ? 'photo' : 'text');
          await saveJournalEntry({
            entryId,
            contentType,
            textContent: input.textContent.trim() || null,
            voicePath: preservedVoicePath,
            photoPaths: mergedPhotoPaths,
            recordedAt,
            now,
            aiTags: aiTags ?? [],
          });
        } else {
          if (!input.voiceDraft.blob || !input.voiceDraft.mimeType || input.voiceDraft.status === 'recording' || input.voiceDraft.status === 'transcribing') {
            input.setSaving(false);
            return;
          }
          let savedVoicePath: string | null = null;
          try {
            const audioBase64 = await blobToBase64(input.voiceDraft.blob);
            const savedAudio = await saveJournalVoiceAudio({
              childId: input.childId,
              entryId,
              mimeType: input.voiceDraft.mimeType,
              audioBase64,
            });
            savedVoicePath = savedAudio.path;
            const payload = resolveVoiceObservationPayload({
              voicePath: savedVoicePath,
              transcript: input.voiceDraft.transcript,
            });
            await saveJournalEntry({
              entryId,
              contentType: payload.contentType,
              textContent: payload.textContent,
              voicePath: payload.voicePath,
              photoPaths: mergedPhotoPaths,
              recordedAt,
              now,
              aiTags: aiTags ?? [],
            });
          } catch (error) {
            if (savedVoicePath) {
              await deleteJournalVoiceAudio(savedVoicePath).catch(catchLog('journal', 'action:rollback-delete-voice-failed', 'warn'));
            }
            throw error;
          }
        }
      } catch (error) {
        await rollbackPhotos(savedPhotoPaths);
        throw error;
      }

      await input.reloadEntries();
      const reminderRuleId = input.searchParams.get('reminderRuleId');
      if (reminderRuleId) {
        // Journal completions historically marked the paired reminder as handled.
        // The journal flow is opened by both guide-kind and practice-kind reminders
        // (see timeline-page-panels.tsx#reminderPrimaryLink); W4b will refine this
        // into the correct per-kind action (acknowledge vs start_practicing) once
        // the progression state machine ships. For W4a we pass the practice kind as
        // a conservative default — it matches the legacy `acknowledge` semantics
        // in reminder-actions.ts without regressing existing behavior.
        const rule = REMINDER_RULES.find((candidate) => candidate.ruleId === reminderRuleId);
        await completeReminderByRule({
          childId: input.childId,
          ruleId: reminderRuleId,
          repeatIndex: Number(input.searchParams.get('repeatIndex') ?? '0') || 0,
          kind: rule?.kind ?? 'practice',
        }).catch(catchLog('journal', 'action:complete-reminder-after-journal-failed', 'warn'));
        input.clearReminderSearchParams();
      }
      const savedDimensionId = input.selectedDimension;
      if (!input.editingEntryId) {
        input.skipLocalDraftPersistRef.current = true;
        clearJournalLocalDraft(input.childId);
        input.setRestorableDraft(null);
        input.setLastAutosavedAt(null);
        input.setLastSavedDraftSignature(null);
      }
      const wasEditing = input.editingEntryId !== null;
      input.resetComposer();
      if (!wasEditing) {
        input.setPostSaveExperiment(getExperimentSuggestion(savedDimensionId));

        const promptMode: 'enrich' | 'confirm' | null = savedKeepsake
          ? (!savedKeepsakeTitle && !savedKeepsakeReason ? 'enrich' : null)
          : (savedSuggestsKeepsake ? 'confirm' : null);

        if (promptMode) {
          const stubEntry: JournalEntryRow = {
            entryId,
            childId: input.childId,
            contentType: 'text',
            textContent: null,
            voicePath: null,
            photoPaths: null,
            recordedAt: now,
            ageMonths: input.ageMonths,
            observationMode: null,
            dimensionId: null,
            selectedTags: null,
            guidedAnswers: null,
            observationDuration: null,
            keepsake: savedKeepsake ? 1 : 0,
            keepsakeTitle: savedKeepsakeTitle || null,
            keepsakeReason: savedKeepsakeReason,
            moodTag: null,
            recorderId: null,
            createdAt: now,
            updatedAt: now,
          };
          input.setPromptKeepsakeTitle(savedKeepsakeTitle);
          input.setPromptKeepsakeReason(savedKeepsakeReason);
          input.setPromptKeepsakeMode(promptMode);
          input.setPendingKeepsakePromptEntry(stubEntry);
        }
      }
    } catch {
      input.setSubmitError('保存失败，请检查本地运行时状态后重试。');
    } finally {
      input.setSaving(false);
    }
  };

  const handleStartRecording = async () => {
    input.setSubmitError(null);
    input.clearVoiceDraft();
    try {
      input.recorderSessionRef.current = await startVoiceRecording();
      input.setVoiceDraft({
        status: 'recording',
        blob: null,
        mimeType: null,
        previewUrl: null,
        transcript: '',
        error: null,
      });
    } catch {
      input.setVoiceDraft({
        ...EMPTY_VOICE_DRAFT,
        status: 'transcription-failed',
        error: '无法启动录音，请确认麦克风权限。',
      });
    }
  };

  const handleStopRecording = async () => {
    const session = input.recorderSessionRef.current;
    if (!session) {
      return;
    }
    input.setSubmitError(null);
    try {
      const result = await session.stop();
      input.recorderSessionRef.current = null;
      input.setVoiceDraft({
        status: 'ready',
        blob: result.blob,
        mimeType: result.mimeType,
        previewUrl: result.previewUrl,
        transcript: '',
        error: null,
      });
    } catch {
      input.recorderSessionRef.current = null;
      input.setVoiceDraft({
        ...EMPTY_VOICE_DRAFT,
        status: 'transcription-failed',
        error: '录音失败，请重试。',
      });
    }
  };

  const handleTranscribe = async () => {
    if (!input.voiceDraft.blob || !input.voiceDraft.mimeType) {
      return;
    }
    input.setSubmitError(null);
    input.setVoiceDraft((current) => ({ ...current, status: 'transcribing', error: null }));
    try {
      const result = await transcribeVoiceObservation({
        audioBlob: input.voiceDraft.blob,
        mimeType: input.voiceDraft.mimeType,
      });
      input.setVoiceDraft((current) => ({
        ...current,
        status: 'transcribed',
        transcript: result.transcript,
        error: null,
      }));
    } catch {
      input.setVoiceDraft((current) => ({
        ...current,
        status: 'transcription-failed',
        transcript: '',
        error: '转写失败，仍可保存语音记录。',
      }));
    }
  };

  return {
    handleAddExperimentTodo,
    handleDeleteEntry,
    handleSaveKeepsakePrompt,
    handleStartRecording,
    handleStopRecording,
    handleSubmit,
    handleToggleKeepsake,
    handleTranscribe,
  };
}
