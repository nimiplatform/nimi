import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { OBSERVATION_DIMENSIONS, OBSERVATION_MODES } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import {
  getJournalEntries,
  insertJournalEntryWithTags,
  updateJournalEntryWithTags,
  updateJournalKeepsake,
  type JournalEntryRow,
  type JournalTagInsertRow,
} from '../../bridge/sqlite-bridge.js';
import { deleteJournalVoiceAudio, saveJournalVoiceAudio } from '../../bridge/journal-audio-bridge.js';
import { saveJournalPhoto, deleteJournalPhoto } from '../../bridge/journal-photo-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  revokeVoicePreviewUrl,
  startVoiceRecording,
  supportsVoiceRecording,
  type VoiceRecordingSession,
} from './voice-observation-recorder.js';
import { hasVoiceTranscriptionRuntime, transcribeVoiceObservation } from './voice-observation-runtime.js';
import { resolveVoiceObservationPayload } from './voice-observation.js';
import {
  hasJournalTaggingRuntime,
  suggestJournalTags,
  type JournalTagSuggestion,
} from './ai-journal-tagging.js';
import {
  type SceneTab,
  type CaptureMode,
  type VoiceDraft,
  type PhotoDraft,
  type TagSuggestionStatus,
  EMPTY_VOICE_DRAFT,
  SCENE_TABS,
  SCENE_MODE_MAP,
  EMOJI_CATEGORIES,
  type EmojiCategory,
  fileToBase64,
  blobToBase64,
  parseSelectedTags,
  getSceneForMode,
} from './journal-page-helpers.js';
import { AutoTagBar, PhotoBar, VoiceCapture } from './journal-sub-components.js';
import { JournalEntryTimeline } from './journal-entry-timeline.js';
import { completeReminderByRule } from '../../engine/reminder-actions.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

/* ── Emoji Picker (portal) ── */

function EmojiPickerPortal({
  anchorRef, category, onCategoryChange, onSelect, onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  category: EmojiCategory;
  onCategoryChange: (c: EmojiCategory) => void;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: Math.max(4, r.left), bottom: window.innerHeight - r.top + 6 });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  const PW = 290; // panel width
  const PH = 260; // panel height
  // clamp so panel stays within viewport
  const left = Math.min(pos.left, window.innerWidth - PW - 8);
  const bottom = Math.min(pos.bottom, window.innerHeight - PH - 8);

  return (
    <div ref={panelRef} className={`fixed z-50 flex flex-col ${S.radiusSm} shadow-xl overflow-hidden`}
      style={{ background: S.card, border: `1px solid ${S.border}`, width: PW, height: PH, left, bottom }}>
      {/* Category tabs */}
      <div className="flex items-center px-1.5 pt-1.5 pb-1 border-b shrink-0" style={{ borderColor: S.border }}>
        {EMOJI_CATEGORIES.map((cat) => (
          <button key={cat.key} onClick={() => onCategoryChange(cat.key)} title={cat.label}
            className={`w-7 h-7 rounded flex items-center justify-center text-[14px] transition-colors ${category === cat.key ? 'bg-[#e8e8e4]' : 'hover:bg-[#f0f0ec]'}`}>
            {cat.icon}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI_CATEGORIES.find((c) => c.key === category)?.emojis.map((emoji, i) => (
            <button key={`${emoji}-${i}`} onClick={() => onSelect(emoji)}
              className="w-[34px] h-[34px] rounded flex items-center justify-center text-[17px] hover:bg-[#f0f0ec] transition-colors">
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════ */

export default function JournalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [activeScene, setActiveScene] = useState<SceneTab>('quick');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('text');
  const [textContent, setTextContent] = useState('');
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null);
  const [keepsake, setKeepsake] = useState(false);
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [subjectiveNotes, setSubjectiveNotes] = useState('');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>(EMPTY_VOICE_DRAFT);
  const [voiceRuntimeAvailable, setVoiceRuntimeAvailable] = useState<boolean | null>(null);
  const [taggingRuntimeAvailable, setTaggingRuntimeAvailable] = useState<boolean | null>(null);
  const [tagSuggestionStatus, setTagSuggestionStatus] = useState<TagSuggestionStatus>('idle');
  const [tagSuggestionError, setTagSuggestionError] = useState<string | null>(null);
  const [confirmedSuggestion, setConfirmedSuggestion] = useState<JournalTagSuggestion | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showClassify, setShowClassify] = useState(false);
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const [entryFilter, setEntryFilter] = useState<'all' | 'quick' | 'deep' | 'review' | 'keepsake'>('all');
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCat, setEmojiCat] = useState<EmojiCategory>('frequent');
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const recorderSessionRef = useRef<VoiceRecordingSession | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const recordingSupported = supportsVoiceRecording();
  const activeMode = SCENE_MODE_MAP[activeScene];
  const modeConfig = OBSERVATION_MODES.find((m) => m.modeId === activeMode);

  const activeDimensions = useMemo(
    () => getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths),
    [ageMonths],
  );

  const currentDimension = activeDimensions.find((item) => item.dimensionId === selectedDimension) ?? null;
  const editingEntry = useMemo(
    () => editingEntryId ? entries.find((entry) => entry.entryId === editingEntryId) ?? null : null,
    [editingEntryId, entries],
  );

  const draftTextForTagging = captureMode === 'text'
    ? textContent.trim()
    : voiceDraft.transcript.trim();

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

  // Auto-focus textarea for quick-note scene
  useEffect(() => {
    if (activeScene === 'quick' && captureMode === 'text') {
      textareaRef.current?.focus();
    }
  }, [activeScene, captureMode]);

  // Auto-trigger AI tag suggestion after user stops typing (1.5s debounce, >=10 chars)
  useEffect(() => {
    if (autoSuggestTimer.current) clearTimeout(autoSuggestTimer.current);
    if (
      draftTextForTagging.length >= 10 &&
      tagSuggestionStatus === 'idle' &&
      taggingRuntimeAvailable !== false
    ) {
      autoSuggestTimer.current = setTimeout(() => {
        void handleSuggestTags();
      }, 1500);
    }
    return () => { if (autoSuggestTimer.current) clearTimeout(autoSuggestTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTextForTagging, tagSuggestionStatus, taggingRuntimeAvailable]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  /* ── Helpers ── */

  const resetSuggestionMetadata = () => {
    setTagSuggestionStatus('idle');
    setTagSuggestionError(null);
    setConfirmedSuggestion(null);
  };

  const applyDimensionSelection = (nextDimensionId: string | null) => {
    setSelectedDimension(nextDimensionId);
    if (!nextDimensionId) {
      setSelectedTags([]);
      resetSuggestionMetadata();
      return;
    }
    const nextDimension = activeDimensions.find((item) => item.dimensionId === nextDimensionId);
    if (!nextDimension) { setSelectedTags([]); resetSuggestionMetadata(); return; }
    const allowedTags = new Set(nextDimension.quickTags);
    setSelectedTags((prev) => prev.filter((tag) => allowedTags.has(tag)));
    setConfirmedSuggestion((prev) => {
      if (!prev || prev.dimensionId !== nextDimensionId) return null;
      return { dimensionId: prev.dimensionId, tags: prev.tags.filter((tag) => allowedTags.has(tag)) };
    });
    setTagSuggestionError(null);
    setTagSuggestionStatus((prev) => (prev === 'failed' ? 'idle' : prev));
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

  const resetComposer = () => {
    setCaptureMode('text'); setTextContent(''); setSelectedDimension(null); setSelectedTags([]);
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
    setEditingEntryId(null);
    setKeepsake(false); setMoodTag(null); setSubjectiveNotes(''); setSubmitError(null); resetSuggestionMetadata(); clearVoiceDraft(); clearPhotoDrafts();
  };

  const reloadEntries = async () => {
    if (!child) return;
    setEntries(await getJournalEntries(child.childId, 50));
  };

  const handleToggleKeepsake = async (entry: JournalEntryRow) => {
    try {
      await updateJournalKeepsake(entry.entryId, entry.keepsake === 1 ? 0 : 1, isoNow());
      await reloadEntries();
    } catch { /* bridge unavailable */ }
  };

  const buildConfirmedAiTags = (): JournalTagInsertRow[] => {
    if (!confirmedSuggestion || !confirmedSuggestion.dimensionId || confirmedSuggestion.dimensionId !== selectedDimension) return [];
    return confirmedSuggestion.tags.filter((tag) => selectedTags.includes(tag)).map((tag) => ({
      tagId: ulid(), domain: 'observation', tag, source: 'ai', confidence: null,
    }));
  };

  /* ── Submit ── */

  const persistPhotos = async (entryId: string): Promise<string | null> => {
    if (photoDrafts.length === 0) return null;
    const savedPaths: string[] = [];
    for (let i = 0; i < photoDrafts.length; i++) {
      const draft = photoDrafts[i]!;
      const base64 = await fileToBase64(draft.file);
      const result = await saveJournalPhoto({
        childId: child.childId, entryId, index: i,
        mimeType: draft.file.type, imageBase64: base64,
      });
      savedPaths.push(result.path);
    }
    return JSON.stringify(savedPaths);
  };

  const rollbackPhotos = async (photoPaths: string | null) => {
    if (!photoPaths) return;
    try {
      const paths = JSON.parse(photoPaths) as string[];
      for (const p of paths) await deleteJournalPhoto(p).catch(catchLog('journal', 'action:rollback-delete-photo-failed', 'warn'));
    } catch { /* ignore */ }
  };

  const saveJournalEntry = async (payload: {
    entryId: string; contentType: string; textContent: string | null;
    voicePath: string | null; photoPaths: string | null; recordedAt: string; now: string;
  }) => {
    const params = {
      entryId: payload.entryId, childId: child.childId,
      contentType: payload.contentType, textContent: payload.textContent,
      voicePath: payload.voicePath, photoPaths: payload.photoPaths,
      recordedAt: payload.recordedAt, ageMonths,
      observationMode: activeMode, dimensionId: selectedDimension,
      selectedTags: selectedTags.length > 0 ? JSON.stringify(selectedTags) : null,
      guidedAnswers: subjectiveNotes.trim() ? JSON.stringify({ _subjective: subjectiveNotes.trim() }) : null,
      observationDuration: activeMode === 'focused-observation' ? 15 : null,
      keepsake: keepsake ? 1 : 0, moodTag, recorderId: selectedRecorderId,
      aiTags: buildConfirmedAiTags(), now: payload.now,
    };
    if (editingEntryId) {
      await updateJournalEntryWithTags(params);
      return;
    }
    await insertJournalEntryWithTags(params);
  };

  const mergePhotoPathJson = (existing: string | null, added: string | null) => {
    const merged: string[] = [];
    for (const raw of [existing, added]) {
      if (!raw) continue;
      try {
        for (const path of JSON.parse(raw) as string[]) {
          if (!merged.includes(path)) merged.push(path);
        }
      } catch { /* ignore invalid photo path json */ }
    }
    return merged.length > 0 ? JSON.stringify(merged) : null;
  };

  const handleSubmit = async () => {
    const now = isoNow();
    setSubmitError(null);
    setSaving(true);

    try {
      const entryId = editingEntryId ?? ulid();
      let savedPhotoPaths: string | null = null;

      try {
        // Save photos first
        savedPhotoPaths = await persistPhotos(entryId);
        const mergedPhotoPaths = mergePhotoPathJson(editingEntry?.photoPaths ?? null, savedPhotoPaths);
        const preservedVoicePath = editingEntry?.voicePath ?? null;
        const recordedAt = editingEntry?.recordedAt ?? now;

        if (captureMode === 'text') {
          if (!textContent.trim() && !mergedPhotoPaths && !preservedVoicePath) { setSaving(false); return; }
          const contentType = preservedVoicePath
            ? (textContent.trim() ? 'mixed' : 'voice')
            : (mergedPhotoPaths && !textContent.trim() ? 'photo' : 'text');
          await saveJournalEntry({
            entryId, contentType,
            textContent: textContent.trim() || null,
            voicePath: preservedVoicePath, photoPaths: mergedPhotoPaths, recordedAt, now,
          });
        } else {
          if (!voiceDraft.blob || !voiceDraft.mimeType || voiceDraft.status === 'recording' || voiceDraft.status === 'transcribing') {
            setSaving(false); return;
          }
          let savedVoicePath: string | null = null;
          try {
            const audioBase64 = await blobToBase64(voiceDraft.blob);
            const savedAudio = await saveJournalVoiceAudio({ childId: child.childId, entryId, mimeType: voiceDraft.mimeType, audioBase64 });
            savedVoicePath = savedAudio.path;
            const payload = resolveVoiceObservationPayload({ voicePath: savedVoicePath, transcript: voiceDraft.transcript });
            await saveJournalEntry({ entryId, contentType: payload.contentType, textContent: payload.textContent, voicePath: payload.voicePath, photoPaths: mergedPhotoPaths, recordedAt, now });
          } catch (error) {
            if (savedVoicePath) await deleteJournalVoiceAudio(savedVoicePath).catch(catchLog('journal', 'action:rollback-delete-voice-failed', 'warn'));
            throw error;
          }
        }
      } catch (error) {
        await rollbackPhotos(savedPhotoPaths);
        throw error;
      }

      await reloadEntries();
      const reminderRuleId = searchParams.get('reminderRuleId');
      if (reminderRuleId) {
        await completeReminderByRule({
          childId: child.childId,
          ruleId: reminderRuleId,
          repeatIndex: Number(searchParams.get('repeatIndex') ?? '0') || 0,
          kind: 'guidance',
        }).catch(catchLog('journal', 'action:complete-reminder-after-journal-failed', 'warn'));
        const next = new URLSearchParams(searchParams);
        next.delete('reminderRuleId');
        next.delete('repeatIndex');
        setSearchParams(next, { replace: true });
      }
      resetComposer();
    } catch {
      setSubmitError('保存失败，请检查本地运行时状态后重试。');
    } finally {
      setSaving(false);
    }
  };

  /* ── Voice ── */

  const handleStartRecording = async () => {
    setSubmitError(null); clearVoiceDraft(); resetSuggestionMetadata();
    try {
      recorderSessionRef.current = await startVoiceRecording();
      setVoiceDraft({ status: 'recording', blob: null, mimeType: null, previewUrl: null, transcript: '', error: null });
    } catch {
      setVoiceDraft({ ...EMPTY_VOICE_DRAFT, status: 'transcription-failed', error: '无法启动录音，请确认麦克风权限。' });
    }
  };

  const handleStopRecording = async () => {
    const session = recorderSessionRef.current;
    if (!session) return;
    setSubmitError(null);
    try {
      const result = await session.stop();
      recorderSessionRef.current = null;
      resetSuggestionMetadata();
      setVoiceDraft({ status: 'ready', blob: result.blob, mimeType: result.mimeType, previewUrl: result.previewUrl, transcript: '', error: null });
    } catch {
      recorderSessionRef.current = null;
      setVoiceDraft({ ...EMPTY_VOICE_DRAFT, status: 'transcription-failed', error: '录音失败，请重试。' });
    }
  };

  const handleTranscribe = async () => {
    if (!voiceDraft.blob || !voiceDraft.mimeType) return;
    setSubmitError(null);
    setVoiceDraft((prev) => ({ ...prev, status: 'transcribing', error: null }));
    try {
      const result = await transcribeVoiceObservation({ audioBlob: voiceDraft.blob, mimeType: voiceDraft.mimeType });
      resetSuggestionMetadata();
      setVoiceDraft((prev) => ({ ...prev, status: 'transcribed', transcript: result.transcript, error: null }));
    } catch {
      setVoiceDraft((prev) => ({ ...prev, status: 'transcription-failed', transcript: '', error: '转写失败，仍可保存语音记录。' }));
    }
  };

  const handleSuggestTags = async () => {
    if (!draftTextForTagging) return;
    const candidateDimensions = selectedDimension && currentDimension ? [currentDimension] : activeDimensions;
    if (candidateDimensions.length === 0) { setTagSuggestionStatus('failed'); setTagSuggestionError('当前年龄段无可用观察维度。'); return; }
    setTagSuggestionStatus('suggesting'); setTagSuggestionError(null);
    try {
      const suggestion = await suggestJournalTags({ draftText: draftTextForTagging, candidateDimensions });
      if (suggestion.dimensionId) {
        const sugDim = candidateDimensions.find((item) => item.dimensionId === suggestion.dimensionId);
        const nextTags = suggestion.tags.filter((tag) => sugDim?.quickTags.includes(tag) ?? false);
        applyDimensionSelection(suggestion.dimensionId);
        setSelectedTags((prev) => [...new Set([...prev, ...nextTags])]);
        setConfirmedSuggestion({ dimensionId: suggestion.dimensionId, tags: nextTags });
      } else {
        setConfirmedSuggestion({ dimensionId: null, tags: [] });
      }
      setTagSuggestionStatus('ready');
    } catch {
      setConfirmedSuggestion(null); setTagSuggestionStatus('failed');
      setTagSuggestionError('AI 标签建议失败。');
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const canSaveText = captureMode === 'text' && (textContent.trim().length > 0 || photoDrafts.length > 0);
  const canSaveVoice = captureMode === 'voice' && Boolean(voiceDraft.blob) && voiceDraft.status !== 'recording' && voiceDraft.status !== 'transcribing';
  const canSuggestTags = draftTextForTagging.length > 0 && tagSuggestionStatus !== 'suggesting' && taggingRuntimeAvailable !== false;

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>成长随记</h1>
        {children.length > 1 ? (
          <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
            options={children.map((c) => ({ value: c.childId, label: c.displayName }))} />
        ) : null}
      </div>

      {/* ── Capture area ── */}
      <section className={`${S.radius} mb-6 overflow-hidden`} style={{ background: S.card, boxShadow: S.shadow }}>
        {/* Hidden photo input */}
        <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { handleAddPhotos(e.target.files); e.target.value = ''; }} />

        {captureMode === 'text' ? (
          <>
            {/* Guidance */}
            <div className="px-5 pt-5 pb-2">
              <p className="text-[12px] leading-relaxed" style={{ color: S.accent }}>
                🌱 不用管对错，像讲故事一样，描述一下孩子刚才的行为细节吧
              </p>
            </div>

            {/* Textarea */}
            <textarea ref={textareaRef} value={textContent}
              onChange={(e) => { setTextContent(e.target.value); resetSuggestionMetadata(); }}
              placeholder="他刚刚做了什么？说了什么？如果遇到了困难，他是如何解决的..."
              className="w-full resize-none px-5 py-3 text-[13px] leading-relaxed outline-none"
              style={{ background: S.card, minHeight: 120, border: 'none' }} rows={5} />

                {/* Photo previews */}
            {photoDrafts.length > 0 && (
              <div className="px-5 pb-2">
                <PhotoBar drafts={photoDrafts} onAdd={handleAddPhotos} onRemove={removePhotoDraft} inputRef={photoInputRef} />
              </div>
            )}

            {/* ── Toolbar ── */}
            <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderTop: `1px solid ${S.border}` }}>
              {/* Voice toggle */}
              <button onClick={() => { setCaptureMode('voice'); setTextContent(''); resetSuggestionMetadata(); }}
                className={`${S.radiusSm} px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors hover:bg-[#f0f0ec]`}
                style={{ background: '#f5f3ef', color: S.sub }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                语音记事
              </button>
              {/* Image */}
              <button onClick={() => photoInputRef.current?.click()}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                style={{ color: S.sub }} title="添加图片">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                </svg>
              </button>
              {/* Emoji panel */}
              <button ref={emojiBtnRef} onClick={() => setShowEmoji(!showEmoji)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                style={{ color: S.sub }} title="表情">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
              {showEmoji && createPortal(
                <EmojiPickerPortal
                  anchorRef={emojiBtnRef}
                  category={emojiCat}
                  onCategoryChange={setEmojiCat}
                  onSelect={(emoji) => {
                    setTextContent((prev) => prev + emoji);
                    setShowEmoji(false);
                    textareaRef.current?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />,
                document.body,
              )}
              {/* Keepsake */}
              <button onClick={() => setKeepsake(!keepsake)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                style={{ color: keepsake ? '#f59e0b' : S.sub }} title="珍藏">
                <svg width="18" height="18" viewBox="0 0 24 24" fill={keepsake ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <div className="flex-1" />
              {/* Save */}
              <button onClick={() => void handleSubmit()} disabled={saving || !canSaveText}
                className={`${S.radiusSm} px-5 py-2 text-[12px] font-medium disabled:opacity-30 transition-colors`}
                style={canSaveText
                  ? { background: S.accent, color: '#fff' }
                  : { background: '#f0f0ec', color: S.sub }}>
                {saving ? '保存中...' : '保存并让 AI 分析'}
              </button>
            </div>
          </>
        ) : (
          /* ── Voice capture mode ── */
          <div className="p-5">
            {voiceDraft.status === 'idle' ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <button onClick={() => void handleStartRecording()} disabled={!recordingSupported}
                  className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                  style={{ background: S.accent, color: '#fff' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </button>
                <p className="text-[12px]" style={{ color: S.sub }}>点击开始语音记录</p>
                <button onClick={() => { setCaptureMode('text'); clearVoiceDraft(); }}
                  className="text-[11px] underline" style={{ color: S.sub }}>
                  切换文字输入
                </button>
                {!recordingSupported && <p className="text-[10px] text-red-500">当前环境不支持录音</p>}
              </div>
            ) : (
              <VoiceCapture
                voiceDraft={voiceDraft} recordingSupported={recordingSupported}
                voiceRuntimeAvailable={voiceRuntimeAvailable}
                onStart={() => void handleStartRecording()} onStop={() => void handleStopRecording()}
                onTranscribe={() => void handleTranscribe()} onClear={() => { clearVoiceDraft(); setCaptureMode('text'); }}
                onTranscriptChange={(t) => {
                  resetSuggestionMetadata();
                  setVoiceDraft((prev) => ({
                    ...prev, transcript: t,
                    status: t.trim().length > 0 ? 'transcribed' : prev.status === 'transcribed' ? 'ready' : prev.status,
                  }));
                }}
              />
            )}
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setKeepsake(!keepsake)}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                style={{ color: keepsake ? '#f59e0b' : S.sub }} title="珍藏">
                <svg width="18" height="18" viewBox="0 0 24 24" fill={keepsake ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <button onClick={() => void handleSubmit()} disabled={saving || !canSaveVoice}
                className={`${S.radiusSm} px-5 py-2 text-[12px] font-medium text-white disabled:opacity-50`}
                style={{ background: S.accent }}>
                {saving ? '保存中...' : '保存并让 AI 分析'}
              </button>
            </div>
          </div>
        )}

        {/* Feedback */}
        {submitError && <p className="text-[11px] px-5 pb-3 text-red-500">{submitError}</p>}
      </section>

      {/* ── Timeline entries ── */}
      <JournalEntryTimeline
        entries={entries}
        entryFilter={entryFilter}
        onFilterChange={setEntryFilter}
        recorderProfiles={child.recorderProfiles}
        onEditEntry={(entry) => {
          setEditingEntryId(entry.entryId);
          setCaptureMode('text');
          setTextContent(entry.textContent ?? '');
          setSelectedDimension(entry.dimensionId);
          setSelectedTags(parseSelectedTags(entry.selectedTags));
          setKeepsake(entry.keepsake === 1);
          setMoodTag(entry.moodTag);
          try {
            const ga = entry.guidedAnswers ? JSON.parse(entry.guidedAnswers) as Record<string, string> : null;
            setSubjectiveNotes(ga?._subjective ?? '');
          } catch { setSubjectiveNotes(''); }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onToggleKeepsake={handleToggleKeepsake}
      />
    </div>
  );
}
