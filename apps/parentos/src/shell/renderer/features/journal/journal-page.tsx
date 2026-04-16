import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import {
  getJournalEntries,
  type JournalEntryRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import {
  revokeVoicePreviewUrl,
  supportsVoiceRecording,
  type VoiceRecordingSession,
} from './voice-observation-recorder.js';
import { hasVoiceTranscriptionRuntime } from './voice-observation-runtime.js';
import {
  hasJournalTaggingRuntime,
} from './ai-journal-tagging.js';
import {
  type CaptureMode,
  type VoiceDraft,
  type PhotoDraft,
  type KeepsakeReason,
  EMPTY_VOICE_DRAFT,
  type EmojiCategory,
  parseSelectedTags,
} from './journal-page-helpers.js';
import { SaveConfirmationModal } from './journal-sub-components.js';
import { JournalEntryTimeline } from './journal-entry-timeline.js';
import { getGuidedPrompts, type GuidedPromptContext } from './journal-guided-prompts.js';
import { type ExperimentTemplate } from './journal-experiment-templates.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import { JournalPageCapture } from './journal-page-capture.js';
import {
  clearJournalLocalDraft,
  hasMeaningfulJournalLocalDraft,
  isRecentJournalDraft,
  KEEPSAKE_KEYWORDS,
  readJournalLocalDraft,
  serializeJournalLocalDraft,
  toJournalLocalDraftPayload,
  type JournalLocalDraftPayload,
  type JournalLocalDraftRecord,
  writeJournalLocalDraft,
} from './journal-page-local-draft.js';
import { DeleteJournalEntryModal, KeepsakePromptModal } from './journal-page-overlays.js';
import { createJournalPersistenceActions } from './journal-page-persistence-actions.js';

export default function JournalPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('text');
  const [textContent, setTextContent] = useState('');
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null);
  const [keepsake, setKeepsake] = useState(false);
  const [keepsakeTitle, setKeepsakeTitle] = useState('');
  const [keepsakeReason, setKeepsakeReason] = useState<KeepsakeReason | null>(null);
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [subjectiveNotes, setSubjectiveNotes] = useState('');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>(EMPTY_VOICE_DRAFT);
  const [voiceRuntimeAvailable, setVoiceRuntimeAvailable] = useState<boolean | null>(null);
  const [taggingRuntimeAvailable, setTaggingRuntimeAvailable] = useState<boolean | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [postSaveExperiment, setPostSaveExperiment] = useState<ExperimentTemplate | null>(null);
  const [addingTodo, setAddingTodo] = useState(false);
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [entryFilter, setEntryFilter] = useState<'all' | 'keepsake'>('all');
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCat, setEmojiCat] = useState<EmojiCategory>('frequent');
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [restorableDraft, setRestorableDraft] = useState<JournalLocalDraftRecord | null>(null);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const [lastSavedDraftSignature, setLastSavedDraftSignature] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingKeepsakePromptEntry, setPendingKeepsakePromptEntry] = useState<JournalEntryRow | null>(null);
  const [promptKeepsakeTitle, setPromptKeepsakeTitle] = useState('');
  const [promptKeepsakeReason, setPromptKeepsakeReason] = useState<KeepsakeReason | null>(null);
  const [savingKeepsakePrompt, setSavingKeepsakePrompt] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const recorderSessionRef = useRef<VoiceRecordingSession | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftAutosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousChildIdRef = useRef<string | null>(null);
  const skipLocalDraftPersistRef = useRef(false);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const recordingSupported = supportsVoiceRecording();
  const activeMode = 'quick-capture';

  const guidedContext: GuidedPromptContext | null = useMemo(() => {
    const ruleId = searchParams.get('reminderRuleId');
    if (!ruleId) return null;
    return getGuidedPrompts(ruleId, REMINDER_RULES);
  }, [searchParams]);

  const activeDimensions = useMemo(
    () => getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths),
    [ageMonths],
  );

  // Pre-select dimension from URL param (e.g., from observe page)
  useEffect(() => {
    const paramDimensionId = searchParams.get('dimensionId');
    if (paramDimensionId && activeDimensions.some((d) => d.dimensionId === paramDimensionId)) {
      setSelectedDimension(paramDimensionId);
      const next = new URLSearchParams(searchParams);
      next.delete('dimensionId');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, activeDimensions, setSearchParams]);

  useEffect(() => {
    const requestedFilter = searchParams.get('filter');
    if (requestedFilter === 'keepsake') {
      setEntryFilter('keepsake');
      return;
    }
    if (requestedFilter === 'all') {
      setEntryFilter('all');
    }
  }, [searchParams]);

  const editingEntry = useMemo(
    () => editingEntryId ? entries.find((entry) => entry.entryId === editingEntryId) ?? null : null,
    [editingEntryId, entries],
  );
  const buildLocalDraftPayload = (draftChildId: string): JournalLocalDraftPayload => ({
    version: 1,
    childId: draftChildId,
    textContent,
    selectedDimension,
    selectedTags,
    selectedRecorderId,
    keepsake,
    keepsakeTitle,
    keepsakeReason,
    moodTag,
    subjectiveNotes,
  });
  const currentLocalDraftPayload = editingEntryId || !child ? null : buildLocalDraftPayload(child.childId);
  const currentLocalDraftSignature = currentLocalDraftPayload ? serializeJournalLocalDraft(currentLocalDraftPayload) : null;
  const currentLocalDraftHasContent = currentLocalDraftPayload
    ? hasMeaningfulJournalLocalDraft(currentLocalDraftPayload)
    : false;

  const draftTextForTagging = captureMode === 'text'
    ? textContent.trim()
    : voiceDraft.transcript.trim();
  const keepsakeSuggestion = useMemo(() => {
    if (keepsake) return null;

    const keyword = KEEPSAKE_KEYWORDS.find((item) => draftTextForTagging.includes(item));
    if (keyword) {
      return `这条里提到了“${keyword}”，如果这是值得纪念的时刻，可以顺手标记为珍藏。`;
    }

    if (photoDrafts.length > 0 && draftTextForTagging.length >= 24) {
      return '这条同时有照片和较完整的描述，看起来很适合珍藏。';
    }

    if (draftTextForTagging.length >= 60) {
      return '这条记录已经比较完整，如果想以后更容易回顾，可以标记为珍藏。';
    }

    return null;
  }, [draftTextForTagging, keepsake, photoDrafts.length]);

  /* ── Effects ── */

  useEffect(() => {
    if (!activeChildId) return;
    getJournalEntries(activeChildId, 50).then(setEntries).catch(catchLog('journal', 'action:load-journal-entries-failed'));
  }, [activeChildId]);

  useEffect(() => {
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
  }, [child?.childId, child?.recorderProfiles]);

  useEffect(() => {
    hasVoiceTranscriptionRuntime().then(setVoiceRuntimeAvailable).catch(catchLogThen('journal', 'action:check-voice-runtime-failed', () => setVoiceRuntimeAvailable(false)));
    hasJournalTaggingRuntime().then(setTaggingRuntimeAvailable).catch(catchLogThen('journal', 'action:check-tagging-runtime-failed', () => setTaggingRuntimeAvailable(false)));
  }, []);

  useEffect(() => () => {
    recorderSessionRef.current?.cancel();
    recorderSessionRef.current = null;
    revokeVoicePreviewUrl(voiceDraft.previewUrl);
  }, [voiceDraft.previewUrl]);

  // Auto-focus textarea for text capture
  useEffect(() => {
    if (captureMode === 'text') {
      textareaRef.current?.focus();
    }
  }, [captureMode]);


  useEffect(() => {
    const nextChildId = child?.childId ?? null;
    const prevChildId = previousChildIdRef.current;

    if (prevChildId && prevChildId !== nextChildId && !editingEntryId) {
      const previousDraftPayload = buildLocalDraftPayload(prevChildId);
      if (hasMeaningfulJournalLocalDraft(previousDraftPayload)) {
        writeJournalLocalDraft({ ...previousDraftPayload, updatedAt: isoNow() });
      }
    }

    if (prevChildId !== nextChildId) {
      previousChildIdRef.current = nextChildId;
      if (!editingEntryId) {
        setCaptureMode('text');
        setTextContent('');
        setSelectedDimension(null);
        setSelectedTags([]);
        setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
        setEditingEntryId(null);
        setKeepsake(false);
        setKeepsakeTitle('');
        setKeepsakeReason(null);
        setMoodTag(null);
        setSubjectiveNotes('');
        setSubmitError(null);
        recorderSessionRef.current?.cancel();
        recorderSessionRef.current = null;
        setVoiceDraft((prev) => { revokeVoicePreviewUrl(prev.previewUrl); return EMPTY_VOICE_DRAFT; });
        setPhotoDrafts((prev) => {
          for (const draft of prev) URL.revokeObjectURL(draft.previewUrl);
          return [];
        });
      }
    }

    if (!nextChildId || editingEntryId) {
      if (!nextChildId) {
        setRestorableDraft(null);
        setLastAutosavedAt(null);
        setLastSavedDraftSignature(null);
      }
      return;
    }

    const storedDraft = readJournalLocalDraft(nextChildId);
    if (storedDraft && isRecentJournalDraft(storedDraft.updatedAt)) {
      // Silently restore recent drafts — no banner interruption
      restoreLocalDraft(storedDraft);
    } else {
      setRestorableDraft(storedDraft);
      setLastAutosavedAt(storedDraft?.updatedAt ?? null);
      setLastSavedDraftSignature(storedDraft
        ? serializeJournalLocalDraft(toJournalLocalDraftPayload(storedDraft))
        : null);
    }
  }, [child?.childId, editingEntryId]);

  useEffect(() => {
    if (draftAutosaveTimer.current) clearTimeout(draftAutosaveTimer.current);
    if (!child || editingEntryId || !currentLocalDraftPayload) return;

    if (!currentLocalDraftHasContent) {
      const storedDraft = readJournalLocalDraft(child.childId);
      if (storedDraft) {
        setRestorableDraft((prev) => prev ?? storedDraft);
        setLastAutosavedAt((prev) => prev ?? storedDraft.updatedAt ?? null);
        setLastSavedDraftSignature((prev) => prev ?? serializeJournalLocalDraft(toJournalLocalDraftPayload(storedDraft)));
        return;
      }

      if (!restorableDraft) {
        clearJournalLocalDraft(child.childId);
        setLastAutosavedAt(null);
        setLastSavedDraftSignature(null);
      }
      return;
    }

    // Dismiss the recovery banner immediately when the user starts typing
    if (restorableDraft) setRestorableDraft(null);

    if (currentLocalDraftSignature && currentLocalDraftSignature === lastSavedDraftSignature) return;

    draftAutosaveTimer.current = setTimeout(() => {
      const updatedAt = isoNow();
      writeJournalLocalDraft({ ...currentLocalDraftPayload, updatedAt });
      setRestorableDraft(null);
      setLastAutosavedAt(updatedAt);
      setLastSavedDraftSignature(currentLocalDraftSignature);
    }, 2000);

    return () => {
      if (draftAutosaveTimer.current) clearTimeout(draftAutosaveTimer.current);
    };
  }, [child, currentLocalDraftHasContent, currentLocalDraftPayload, currentLocalDraftSignature, editingEntryId, lastSavedDraftSignature, restorableDraft]);

  useEffect(() => {
    if (!child || editingEntryId) return;

    const syncRestorableDraft = () => {
      const storedDraft = readJournalLocalDraft(child.childId);
      const composerHasMeaningfulDraft = currentLocalDraftHasContent;

      if (!storedDraft) {
        if (!composerHasMeaningfulDraft) {
          setRestorableDraft(null);
          setLastAutosavedAt(null);
          setLastSavedDraftSignature(null);
        }
        return;
      }

      if (composerHasMeaningfulDraft) return;

      const storedDraftSignature = serializeJournalLocalDraft(toJournalLocalDraftPayload(storedDraft));
      setRestorableDraft((prev) => {
        if (!prev) return storedDraft;
        const previousSignature = serializeJournalLocalDraft(toJournalLocalDraftPayload(prev));
        return previousSignature === storedDraftSignature && prev.updatedAt === storedDraft.updatedAt
          ? prev
          : storedDraft;
      });
      setLastAutosavedAt((prev) => prev === (storedDraft.updatedAt ?? null) ? prev : (storedDraft.updatedAt ?? null));
      setLastSavedDraftSignature((prev) => prev === storedDraftSignature ? prev : storedDraftSignature);
    };

    syncRestorableDraft();

    const handleVisibilityChange = () => {
      if (!document.hidden) syncRestorableDraft();
    };

    window.addEventListener('focus', syncRestorableDraft);
    window.addEventListener('pageshow', syncRestorableDraft);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', syncRestorableDraft);
      window.removeEventListener('pageshow', syncRestorableDraft);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [child?.childId, currentLocalDraftHasContent, editingEntryId]);

  useEffect(() => () => {
    if (draftAutosaveTimer.current) clearTimeout(draftAutosaveTimer.current);
    if (skipLocalDraftPersistRef.current) {
      skipLocalDraftPersistRef.current = false;
      return;
    }
    if (!child || editingEntryId || !currentLocalDraftPayload) return;
    if (!currentLocalDraftHasContent) return;

    const updatedAt = isoNow();
    writeJournalLocalDraft({ ...currentLocalDraftPayload, updatedAt });
  }, [child, currentLocalDraftHasContent, currentLocalDraftPayload, editingEntryId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  /* ── Helpers ── */


  const clearReminderSearchParams = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('reminderRuleId');
    next.delete('repeatIndex');
    setSearchParams(next, { replace: true });
  };

  const closeKeepsakePrompt = () => {
    setPendingKeepsakePromptEntry(null);
    setPromptKeepsakeTitle('');
    setPromptKeepsakeReason(null);
    setSavingKeepsakePrompt(false);
  };

  const clearVoiceDraft = () => {
    recorderSessionRef.current?.cancel();
    recorderSessionRef.current = null;
    setVoiceDraft((prev) => { revokeVoicePreviewUrl(prev.previewUrl); return EMPTY_VOICE_DRAFT; });
  };

  const clearPhotoDrafts = () => {
    for (const d of photoDrafts) URL.revokeObjectURL(d.previewUrl);
    setPhotoDrafts([]);
  };

  const handleAddPhotos = (files: FileList | null) => {
    if (!files) return;
    const newDrafts: PhotoDraft[] = [];
    for (let i = 0; i < files.length && photoDrafts.length + newDrafts.length < 9; i++) {
      const file = files[i]!;
      if (!file.type.startsWith('image/')) continue;
      newDrafts.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPhotoDrafts((prev) => [...prev, ...newDrafts]);
  };

  const removePhotoDraft = (index: number) => {
    setPhotoDrafts((prev) => {
      const next = [...prev];
      const removed = next.splice(index, 1)[0];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const restoreLocalDraft = (draft: JournalLocalDraftRecord) => {
    const nextDimension = activeDimensions.find((item) => item.dimensionId === draft.selectedDimension) ?? null;
    const nextTags = nextDimension
      ? draft.selectedTags.filter((tag) => nextDimension.quickTags.includes(tag))
      : [];
    const nextPayload: JournalLocalDraftPayload = {
      version: 1,
      childId: draft.childId,
      textContent: draft.textContent,
      selectedDimension: nextDimension?.dimensionId ?? null,
      selectedTags: nextTags,
      selectedRecorderId: draft.selectedRecorderId,
      keepsake: draft.keepsake,
      keepsakeTitle: draft.keepsakeTitle,
      keepsakeReason: draft.keepsakeReason,
      moodTag: draft.moodTag,
      subjectiveNotes: draft.subjectiveNotes,
    };

    setEditingEntryId(null);
    setCaptureMode('text');
    setTextContent(nextPayload.textContent);
    setSelectedDimension(nextPayload.selectedDimension);
    setSelectedTags(nextPayload.selectedTags);
    setSelectedRecorderId(nextPayload.selectedRecorderId ?? child?.recorderProfiles?.[0]?.id ?? null);
    setKeepsake(nextPayload.keepsake);
    setKeepsakeTitle(nextPayload.keepsakeTitle);
    setKeepsakeReason(nextPayload.keepsakeReason);
    setMoodTag(nextPayload.moodTag);
    setSubjectiveNotes(nextPayload.subjectiveNotes);
    setSubmitError(null);
    clearVoiceDraft();
    clearPhotoDrafts();
    setRestorableDraft(null);
    setLastAutosavedAt(draft.updatedAt);
    setLastSavedDraftSignature(serializeJournalLocalDraft(nextPayload));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const discardLocalDraft = () => {
    skipLocalDraftPersistRef.current = true;
    clearJournalLocalDraft(child.childId);
    setRestorableDraft(null);
    setLastAutosavedAt(null);
    setLastSavedDraftSignature(null);
  };

  const resetComposer = () => {
    setCaptureMode('text'); setTextContent(''); setSelectedDimension(null); setSelectedTags([]);
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
    setEditingEntryId(null);
    setKeepsake(false); setKeepsakeTitle(''); setKeepsakeReason(null); setMoodTag(null); setSubjectiveNotes(''); setSubmitError(null); clearVoiceDraft(); clearPhotoDrafts();
    closeKeepsakePrompt();
  };

  const reloadEntries = async () => {
    if (!child) return;
    setEntries(await getJournalEntries(child.childId, 50));
  };

  const handleDismissExperiment = () => {
    setPostSaveExperiment(null);
  };

  const toggleComposerKeepsake = () => {
    setKeepsake((prev) => {
      if (prev) {
        setKeepsakeTitle('');
        setKeepsakeReason(null);
      }
      return !prev;
    });
  };

  const {
    handleAddExperimentTodo,
    handleDeleteEntry,
    handleSaveKeepsakePrompt,
    handleStartRecording,
    handleStopRecording,
    handleSubmit,
    handleToggleKeepsake,
    handleTranscribe,
  } = createJournalPersistenceActions({
    childId: child.childId,
    ageMonths,
    activeMode,
    selectedDimension,
    selectedTags,
    subjectiveNotes,
    keepsake,
    keepsakeTitle,
    keepsakeReason,
    moodTag,
    selectedRecorderId,
    editingEntryId,
    editingEntry,
    captureMode,
    textContent,
    voiceDraft,
    photoDrafts,
    searchParams,
    recorderSessionRef,
    skipLocalDraftPersistRef,
    setSubmitError,
    setSaving,
    setAddingTodo,
    setDeleting,
    setDeleteTarget,
    setPendingKeepsakePromptEntry,
    setPromptKeepsakeTitle,
    setPromptKeepsakeReason,
    setSavingKeepsakePrompt,
    setPostSaveExperiment,
    setRestorableDraft,
    setLastAutosavedAt,
    setLastSavedDraftSignature,
    setVoiceDraft,
    reloadEntries,
    resetComposer,
    clearReminderSearchParams,
    closeKeepsakePrompt,
    clearVoiceDraft,
    deleteTarget,
    pendingKeepsakePromptEntry,
    promptKeepsakeTitle,
    promptKeepsakeReason,
    postSaveExperiment,
  });

  const canSaveText = captureMode === 'text' && (
    textContent.trim().length > 0
    || photoDrafts.length > 0
    || Boolean(editingEntry?.voicePath)
    || parseSelectedTags(editingEntry?.photoPaths ?? null).length > 0
  );
  const canSaveVoice = captureMode === 'voice' && Boolean(voiceDraft.blob) && voiceDraft.status !== 'recording' && voiceDraft.status !== 'transcribing';
  const editingEntryLabel = editingEntry
    ? `${editingEntry.recordedAt.split('T')[0]} ${editingEntry.recordedAt.split('T')[1]?.slice(0, 5) ?? ''}`.trim()
    : null;
  const draftStatusLabel = !editingEntryId && currentLocalDraftPayload && hasMeaningfulJournalLocalDraft(currentLocalDraftPayload)
    ? (currentLocalDraftSignature === lastSavedDraftSignature && lastAutosavedAt ? '已自动保存' : '未保存')
    : null;

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */

  return (
    <div className={`${S.container} hide-scrollbar`} style={{ paddingTop: 16, minHeight: '100%' }}>
      <JournalPageCapture
        activeChildId={activeChildId}
        childOptions={children.map((item) => ({ value: item.childId, label: item.displayName }))}
        onChildChange={setActiveChildId}
        guidedContext={guidedContext}
        restorableDraft={restorableDraft}
        editingEntry={editingEntry}
        editingEntryLabel={editingEntryLabel}
        onDiscardLocalDraft={discardLocalDraft}
        onRestoreLocalDraft={restoreLocalDraft}
        onResetComposer={resetComposer}
        onClearReminderSearchParams={clearReminderSearchParams}
        captureMode={captureMode}
        onCaptureModeChange={setCaptureMode}
        textContent={textContent}
        onTextContentChange={(value) => {
          setTextContent(value);
          if (postSaveExperiment) setPostSaveExperiment(null);
        }}
        photoInputRef={photoInputRef}
        onAddPhotos={handleAddPhotos}
        photoDrafts={photoDrafts}
        onRemovePhotoDraft={removePhotoDraft}
        keepsakeSuggestion={keepsakeSuggestion}
        onToggleKeepsake={toggleComposerKeepsake}
        keepsake={keepsake}
        keepsakeTitle={keepsakeTitle}
        onKeepsakeTitleChange={setKeepsakeTitle}
        keepsakeReason={keepsakeReason}
        onKeepsakeReasonChange={setKeepsakeReason}
        showEmoji={showEmoji}
        onShowEmojiChange={setShowEmoji}
        emojiBtnRef={emojiBtnRef}
        emojiCat={emojiCat}
        onEmojiCategoryChange={setEmojiCat}
        textareaRef={textareaRef}
        draftStatusLabel={draftStatusLabel}
        saving={saving}
        canSaveText={canSaveText}
        canSaveVoice={canSaveVoice}
        editingEntryId={editingEntryId}
        onRequestSave={() => {
          if (taggingRuntimeAvailable !== false && !editingEntry) {
            setShowSaveModal(true);
            return;
          }
          void handleSubmit();
        }}
        voiceDraft={voiceDraft}
        recordingSupported={recordingSupported}
        voiceRuntimeAvailable={voiceRuntimeAvailable}
        onStartRecording={() => void handleStartRecording()}
        onStopRecording={() => void handleStopRecording()}
        onTranscribe={() => void handleTranscribe()}
        onClearVoiceDraft={clearVoiceDraft}
        onVoiceTranscriptChange={(transcript) => {
          setVoiceDraft((prev) => ({
            ...prev,
            transcript,
            status: transcript.trim().length > 0 ? 'transcribed' : prev.status === 'transcribed' ? 'ready' : prev.status,
          }));
        }}
        submitError={submitError}
        postSaveExperiment={postSaveExperiment}
        addingTodo={addingTodo}
        onAddExperimentTodo={() => void handleAddExperimentTodo()}
        onDismissExperiment={handleDismissExperiment}
      />

      {/* ── Timeline entries ── */}
      <JournalEntryTimeline
        entries={entries}
        entryFilter={entryFilter}
        onFilterChange={setEntryFilter}
        recorderProfiles={child.recorderProfiles}
        onAskAiAboutEntry={(entry) => {
          const dimensionName = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId)?.displayName ?? null;
          const recorderName = child.recorderProfiles?.find((item) => item.id === entry.recorderId)?.name ?? null;
          navigate('/advisor', {
            state: {
              journalEntryContext: {
                entryId: entry.entryId,
                recordedAt: entry.recordedAt,
                contentType: entry.contentType,
                textContent: entry.textContent,
                dimensionName,
                tags: parseSelectedTags(entry.selectedTags),
                recorderName,
              },
            },
          });
        }}
        onEditEntry={(entry) => {
          setEditingEntryId(entry.entryId);
          setCaptureMode('text');
          setTextContent(entry.textContent ?? '');
          setSelectedDimension(entry.dimensionId);
          setSelectedTags(parseSelectedTags(entry.selectedTags));
          setSelectedRecorderId(entry.recorderId ?? child.recorderProfiles?.[0]?.id ?? null);
          setKeepsake(entry.keepsake === 1);
          setKeepsakeTitle(entry.keepsakeTitle ?? '');
          setKeepsakeReason(entry.keepsakeReason ?? null);
          setMoodTag(entry.moodTag);
          clearReminderSearchParams();
                   try {
            const ga = entry.guidedAnswers ? JSON.parse(entry.guidedAnswers) as Record<string, string> : null;
            setSubjectiveNotes(ga?._subjective ?? '');
          } catch { setSubjectiveNotes(''); }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onDeleteEntry={(entry) => setDeleteTarget(entry)}
        onToggleKeepsake={handleToggleKeepsake}
      />
      {deleteTarget ? (
        <DeleteJournalEntryModal
          entry={deleteTarget}
          deleting={deleting}
          onCancel={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={() => void handleDeleteEntry()}
        />
      ) : null}
      <KeepsakePromptModal
        open={pendingKeepsakePromptEntry !== null}
        title={promptKeepsakeTitle}
        reason={promptKeepsakeReason}
        saving={savingKeepsakePrompt}
        onTitleChange={setPromptKeepsakeTitle}
        onReasonChange={setPromptKeepsakeReason}
        onSkip={closeKeepsakePrompt}
        onSave={() => void handleSaveKeepsakePrompt()}
      />
      {showSaveModal && (
        <SaveConfirmationModal
          textPreview={captureMode === 'text' ? textContent.trim() : voiceDraft.transcript.trim()}
          selectedDimension={selectedDimension}
          selectedTags={selectedTags}
          dimensions={activeDimensions}
          draftTextForTagging={draftTextForTagging}
          onConfirm={(aiTags) => { setShowSaveModal(false); void handleSubmit(aiTags); }}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
