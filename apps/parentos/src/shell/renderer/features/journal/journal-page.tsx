import { useEffect, useMemo, useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { OBSERVATION_DIMENSIONS, OBSERVATION_MODES } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import {
  getJournalEntries,
  insertJournalEntryWithTags,
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
  QUICK_EMOJIS,
  fileToBase64,
  blobToBase64,
  parseSelectedTags,
  getSceneForMode,
} from './journal-page-helpers.js';
import { AutoTagBar, PhotoBar, VoiceCapture } from './journal-sub-components.js';
import { JournalEntryTimeline } from './journal-entry-timeline.js';

/* ════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════ */

export default function JournalPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [activeScene, setActiveScene] = useState<SceneTab>('quick');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('text');
  const [textContent, setTextContent] = useState('');
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedRecorderId, setSelectedRecorderId] = useState<string | null>(null);
  const [keepsake, setKeepsake] = useState(false);
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

  const draftTextForTagging = captureMode === 'text'
    ? textContent.trim()
    : voiceDraft.transcript.trim();

  /* ── Effects ── */

  useEffect(() => {
    if (!activeChildId) return;
    getJournalEntries(activeChildId, 50).then(setEntries).catch(() => {});
  }, [activeChildId]);

  useEffect(() => {
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
  }, [child?.childId, child?.recorderProfiles]);

  useEffect(() => {
    hasVoiceTranscriptionRuntime().then(setVoiceRuntimeAvailable).catch(() => setVoiceRuntimeAvailable(false));
    hasJournalTaggingRuntime().then(setTaggingRuntimeAvailable).catch(() => setTaggingRuntimeAvailable(false));
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
    setKeepsake(false); setSubmitError(null); resetSuggestionMetadata(); clearVoiceDraft(); clearPhotoDrafts();
  };

  const reloadEntries = async () => {
    if (!child) return;
    setEntries(await getJournalEntries(child.childId, 50));
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
      for (const p of paths) await deleteJournalPhoto(p).catch(() => {});
    } catch { /* ignore */ }
  };

  const saveJournalEntry = async (payload: {
    entryId: string; contentType: string; textContent: string | null;
    voicePath: string | null; photoPaths: string | null; recordedAt: string; now: string;
  }) => {
    await insertJournalEntryWithTags({
      entryId: payload.entryId, childId: child.childId,
      contentType: payload.contentType, textContent: payload.textContent,
      voicePath: payload.voicePath, photoPaths: payload.photoPaths,
      recordedAt: payload.recordedAt, ageMonths,
      observationMode: activeMode, dimensionId: selectedDimension,
      selectedTags: selectedTags.length > 0 ? JSON.stringify(selectedTags) : null,
      guidedAnswers: null, observationDuration: activeMode === 'focused-observation' ? 15 : null,
      keepsake: keepsake ? 1 : 0, recorderId: selectedRecorderId,
      aiTags: buildConfirmedAiTags(), now: payload.now,
    });
  };

  const handleSubmit = async () => {
    const now = isoNow();
    setSubmitError(null);
    setSaving(true);

    try {
      const entryId = ulid();
      let savedPhotoPaths: string | null = null;

      try {
        // Save photos first
        savedPhotoPaths = await persistPhotos(entryId);

        if (captureMode === 'text') {
          if (!textContent.trim() && !savedPhotoPaths) { setSaving(false); return; }
          await saveJournalEntry({
            entryId, contentType: savedPhotoPaths && !textContent.trim() ? 'photo' : 'text',
            textContent: textContent.trim() || null,
            voicePath: null, photoPaths: savedPhotoPaths, recordedAt: now, now,
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
            await saveJournalEntry({ entryId, contentType: payload.contentType, textContent: payload.textContent, voicePath: payload.voicePath, photoPaths: savedPhotoPaths, recordedAt: now, now });
          } catch (error) {
            if (savedVoicePath) await deleteJournalVoiceAudio(savedVoicePath).catch(() => {});
            throw error;
          }
        }
      } catch (error) {
        await rollbackPhotos(savedPhotoPaths);
        throw error;
      }

      await reloadEntries();
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
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>观察日志</h1>
        {child.recorderProfiles?.length ? (
          <select value={selectedRecorderId ?? ''} onChange={(e) => setSelectedRecorderId(e.target.value || null)}
            className={`${S.radiusSm} px-2 py-1 text-[11px]`} style={{ border: `1px solid ${S.border}` }}>
            {child.recorderProfiles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : null}
      </div>
      <p className="text-[12px] mb-5" style={{ color: S.sub }}>
        {child.displayName} · {formatAge(ageMonths)}
      </p>

      {/* ── Scene tabs ── */}
      <div className="flex gap-2 mb-5">
        {SCENE_TABS.map((tab) => (
          <button key={tab.key}
            onClick={() => { setActiveScene(tab.key); resetComposer(); }}
            className={`flex-1 ${S.radiusSm} p-3 text-left transition-all`}
            style={{
              border: `1.5px solid ${activeScene === tab.key ? S.accent : S.border}`,
              background: activeScene === tab.key ? '#f4f7ea' : S.card,
            }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[14px]">{tab.emoji}</span>
              <span className="text-[13px] font-semibold" style={{ color: activeScene === tab.key ? S.accent : S.text }}>
                {tab.label}
              </span>
            </div>
            <p className="text-[10px]" style={{ color: S.sub }}>{tab.sub}</p>
          </button>
        ))}
      </div>

      {/* ── Capture area ── */}
      <section className={`${S.radius} p-5 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
        {/* Global hidden photo input */}
        <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { handleAddPhotos(e.target.files); e.target.value = ''; }} />

        {/* Scene guidance */}
        {modeConfig?.guidancePrompt && (
          <p className="text-[12px] mb-3 leading-relaxed" style={{ color: S.sub }}>
            💡 {activeScene === 'review'
              ? '最近这段时间，孩子的行为有没有让你觉得有意思、意外、或者特别的地方？'
              : modeConfig.guidancePrompt}
          </p>
        )}

        {/* ─ Quick Note ─ */}
        {activeScene === 'quick' && (
          <div className="space-y-3">
            {captureMode === 'text' ? (
              <div className={S.radius} style={{ border: `1px solid ${S.border}`, overflow: 'hidden' }}>
                {/* Text area — no border, clean white */}
                <textarea ref={textareaRef} value={textContent}
                  onChange={(e) => { setTextContent(e.target.value); resetSuggestionMetadata(); }}
                  placeholder="刚刚看到了什么？随手记下来..."
                  className="w-full resize-none p-4 text-[13px] leading-relaxed outline-none"
                  style={{ background: S.card, minHeight: 110, border: 'none' }} rows={4} />

                {/* Photo previews inside the box */}
                {photoDrafts.length > 0 && (
                  <div className="px-4 pb-2" style={{ background: S.card }}>
                    <PhotoBar drafts={photoDrafts} onAdd={handleAddPhotos} onRemove={removePhotoDraft} inputRef={photoInputRef} />
                  </div>
                )}

                {/* Bottom toolbar — thin divider line + icon row */}
                <div className="flex items-center gap-0.5 px-3 py-2" style={{ borderTop: `1px solid ${S.border}`, background: S.card }}>
                  {/* Emoji */}
                  <div className="relative">
                    <button onClick={() => setShowEmoji(!showEmoji)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                      style={{ color: S.sub }} title="表情">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </button>
                    {showEmoji && (
                      <div className={`absolute left-0 bottom-10 z-10 p-2 grid grid-cols-8 gap-1 ${S.radiusSm} shadow-lg`}
                        style={{ background: S.card, border: `1px solid ${S.border}`, width: 260 }}>
                        {QUICK_EMOJIS.map((emoji) => (
                          <button key={emoji} onClick={() => {
                            setTextContent((prev) => prev + emoji);
                            setShowEmoji(false);
                            textareaRef.current?.focus();
                          }}
                            className="w-7 h-7 rounded flex items-center justify-center text-[16px] hover:bg-[#f0f0ec] transition-colors">
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Image */}
                  <button onClick={() => photoInputRef.current?.click()}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                    style={{ color: S.sub }} title="添加图片">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                    </svg>
                  </button>
                  {/* Voice */}
                  <button onClick={() => { setCaptureMode('voice'); setTextContent(''); resetSuggestionMetadata(); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                    style={{ color: S.sub }} title="语音输入">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </button>
                  {/* Keepsake */}
                  <button onClick={() => setKeepsake(!keepsake)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                    style={{ color: keepsake ? '#f59e0b' : S.sub }} title="珍藏">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={keepsake ? '#f59e0b' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                  <div className="flex-1" />
                  {/* Send */}
                  <button onClick={() => void handleSubmit()} disabled={saving || !canSaveText}
                    className={`${S.radiusSm} px-4 py-1.5 text-[12px] disabled:opacity-30`}
                    style={canSaveText
                      ? { background: S.accent, color: '#fff', fontWeight: 500 }
                      : { background: '#f0f0ec', color: S.sub }}>
                    {saving ? '...' : '保存'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {voiceDraft.status === 'idle' ? (
                  /* Big mic button — primary voice capture */
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
                      或切换文字输入
                    </button>
                    {!recordingSupported && <p className="text-[10px] text-red-500">当前环境不支持录音</p>}
                  </div>
                ) : (
                  <VoiceCapture
                    voiceDraft={voiceDraft} recordingSupported={recordingSupported}
                    voiceRuntimeAvailable={voiceRuntimeAvailable}
                    onStart={() => void handleStartRecording()} onStop={() => void handleStopRecording()}
                    onTranscribe={() => void handleTranscribe()} onClear={() => { clearVoiceDraft(); setCaptureMode('voice'); }}
                    onTranscriptChange={(t) => {
                      resetSuggestionMetadata();
                      setVoiceDraft((prev) => ({
                        ...prev, transcript: t,
                        status: t.trim().length > 0 ? 'transcribed' : prev.status === 'transcribed' ? 'ready' : prev.status,
                      }));
                    }}
                  />
                )}
              </div>
            )}

            {/* AI auto-suggested tags — shown inline after input */}
            <AutoTagBar
              status={tagSuggestionStatus} suggestion={confirmedSuggestion}
              selectedTags={selectedTags} selectedDimension={selectedDimension}
              dimensions={activeDimensions} onToggleTag={toggleTag}
              onRetry={() => void handleSuggestTags()}
            />

            {/* Voice mode save row (text mode has save in toolbar) */}
            {captureMode === 'voice' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: S.sub }}>
                  <input type="checkbox" checked={keepsake} onChange={(e) => setKeepsake(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                  ⭐ 珍藏
                </label>
                <button onClick={() => void handleSubmit()} disabled={saving || !canSaveVoice}
                  className={`${S.radiusSm} px-6 py-2 text-[13px] font-medium text-white disabled:opacity-50`}
                  style={{ background: S.accent }}>
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─ Deep Dive: input-first, classify after ─ */}
        {activeScene === 'deep' && (
          <div className="space-y-4">
            {/* 1. Capture mode + input FIRST */}
            <div className="flex items-center gap-2">
              <button onClick={() => { setCaptureMode('text'); clearVoiceDraft(); }}
                className={`${S.radiusSm} px-3 py-1.5 text-[12px]`}
                style={captureMode === 'text' ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
                ✏️ 文字
              </button>
              <button onClick={() => { setCaptureMode('voice'); setTextContent(''); resetSuggestionMetadata(); }}
                className={`${S.radiusSm} px-3 py-1.5 text-[12px]`}
                style={captureMode === 'voice' ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
                🎙️ 语音
              </button>
            </div>

            {captureMode === 'text' ? (
              <textarea value={textContent}
                onChange={(e) => { setTextContent(e.target.value); resetSuggestionMetadata(); }}
                placeholder="详细记录你观察到的行为、情绪、语言..."
                className={`w-full resize-none ${S.radiusSm} p-3 text-[13px]`}
                style={{ border: `1px solid ${S.border}` }} rows={6} />
            ) : (
              <VoiceCapture voiceDraft={voiceDraft} recordingSupported={recordingSupported}
                voiceRuntimeAvailable={voiceRuntimeAvailable}
                onStart={() => void handleStartRecording()} onStop={() => void handleStopRecording()}
                onTranscribe={() => void handleTranscribe()} onClear={clearVoiceDraft}
                onTranscriptChange={(t) => {
                  resetSuggestionMetadata();
                  setVoiceDraft((prev) => ({
                    ...prev, transcript: t,
                    status: t.trim().length > 0 ? 'transcribed' : prev.status === 'transcribed' ? 'ready' : prev.status,
                  }));
                }}
              />
            )}

            {/* 2. AI auto-tags inline */}
            <AutoTagBar
              status={tagSuggestionStatus} suggestion={confirmedSuggestion}
              selectedTags={selectedTags} selectedDimension={selectedDimension}
              dimensions={activeDimensions} onToggleTag={toggleTag}
              onRetry={() => void handleSuggestTags()}
            />

            {/* 3. Classify — collapsible, AFTER input */}
            <div>
              <button onClick={() => setShowClassify(!showClassify)}
                className="flex items-center gap-1.5 text-[11px] font-medium w-full"
                style={{ color: S.sub }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: showClassify ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>
                  <path d="m9 18 6-6-6-6" />
                </svg>
                分类归档
                {selectedDimension && (
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] ml-1" style={{ background: '#e8eccc', color: S.accent }}>
                    {activeDimensions.find((d) => d.dimensionId === selectedDimension)?.displayName}
                  </span>
                )}
                {selectedTags.length > 0 && (
                  <span className="text-[10px] ml-1" style={{ color: S.accent }}>{selectedTags.length} 个标签</span>
                )}
              </button>

              {showClassify && (
                <div className={`mt-2 space-y-3 ${S.radiusSm} p-3`} style={{ background: S.bg }}>
                  {/* Dimension selector */}
                  {activeDimensions.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px]" style={{ color: S.sub }}>观察维度</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activeDimensions.map((dim) => (
                          <button key={dim.dimensionId}
                            onClick={() => applyDimensionSelection(selectedDimension === dim.dimensionId ? null : dim.dimensionId)}
                            className="rounded-full px-2.5 py-1 text-[11px] transition-colors"
                            style={selectedDimension === dim.dimensionId
                              ? { background: S.accent, color: '#fff' }
                              : { background: S.card, color: S.sub, border: `1px solid ${S.border}` }}>
                            {dim.displayName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Guided questions */}
                  {currentDimension && (
                    <div>
                      <p className="mb-1 text-[10px] font-medium" style={{ color: S.text }}>引导问题</p>
                      <ul className="space-y-0.5">
                        {currentDimension.guidedQuestions.map((q) => (
                          <li key={q} className="text-[10px]" style={{ color: S.sub }}>• {q}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Quick tags */}
                  {currentDimension && currentDimension.quickTags.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px]" style={{ color: S.sub }}>快速标签</p>
                      <div className="flex flex-wrap gap-1">
                        {currentDimension.quickTags.map((tag) => (
                          <button key={tag} onClick={() => toggleTag(tag)}
                            className="rounded-full px-2 py-0.5 text-[10px]"
                            style={selectedTags.includes(tag)
                              ? { background: '#e8eccc', color: S.accent }
                              : { background: S.card, color: S.sub, border: `1px solid ${S.border}` }}>
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Save row */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: S.sub }}>
                <input type="checkbox" checked={keepsake} onChange={(e) => setKeepsake(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                ⭐ 珍藏
              </label>
              <button onClick={() => void handleSubmit()} disabled={saving || (captureMode === 'text' ? !canSaveText : !canSaveVoice)}
                className={`${S.radiusSm} px-5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50`}
                style={{ background: S.accent }}>
                {saving ? '保存中...' : '保存观察'}
              </button>
            </div>
          </div>
        )}

        {/* ─ Review: reflection mode ─ */}
        {activeScene === 'review' && (
          <div className="space-y-3">
            <textarea value={textContent}
              onChange={(e) => { setTextContent(e.target.value); resetSuggestionMetadata(); }}
              placeholder="回顾这段时间，孩子有哪些成长变化？哪些瞬间让你印象深刻？写下你的感悟..."
              className={`w-full resize-none ${S.radiusSm} p-3 text-[13px]`}
              style={{ border: `1px solid ${S.border}`, minHeight: 120 }} rows={6} />

            {/* Photo upload */}
            <div className="flex items-center gap-2">
              <button onClick={() => photoInputRef.current?.click()}
                className={`${S.radiusSm} px-3 py-1.5 text-[11px] flex items-center gap-1.5`}
                style={{ background: '#f0f0ec', color: S.sub }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                添加图片
              </button>
              {photoDrafts.length > 0 && (
                <span className="text-[10px]" style={{ color: S.sub }}>{photoDrafts.length} 张</span>
              )}
            </div>
            {photoDrafts.length > 0 && (
              <PhotoBar drafts={photoDrafts} onAdd={handleAddPhotos} onRemove={removePhotoDraft} inputRef={photoInputRef} />
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: S.sub }}>
                <input type="checkbox" checked={keepsake} onChange={(e) => setKeepsake(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                ⭐ 珍藏
              </label>
              <button onClick={() => void handleSubmit()} disabled={saving || !canSaveText}
                className={`${S.radiusSm} px-5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50`}
                style={{ background: S.accent }}>
                {saving ? '保存中...' : '保存感悟'}
              </button>
            </div>
          </div>
        )}

        {/* Tag suggestion feedback */}
        {tagSuggestionStatus === 'ready' && confirmedSuggestion?.dimensionId && (
          <p className="text-[10px] mt-2" style={{ color: S.accent }}>
            ✨ AI 已建议维度和标签，请确认后保存。
          </p>
        )}
        {tagSuggestionStatus === 'ready' && confirmedSuggestion?.dimensionId === null && (
          <p className="text-[10px] mt-2" style={{ color: S.sub }}>
            AI 未找到足够匹配的标签建议。
          </p>
        )}
        {tagSuggestionError && <p className="text-[10px] mt-2 text-red-500">{tagSuggestionError}</p>}
        {submitError && <p className="text-[11px] mt-2 text-red-500">{submitError}</p>}
      </section>

      {/* ── Timeline entries ── */}
      <JournalEntryTimeline
        entries={entries}
        entryFilter={entryFilter}
        onFilterChange={setEntryFilter}
        recorderProfiles={child.recorderProfiles}
        onEditEntry={(entry) => {
          setEditingEntryId(entry.entryId);
          setActiveScene(getSceneForMode(entry.observationMode));
          setTextContent(entry.textContent ?? '');
          setSelectedDimension(entry.dimensionId);
          setSelectedTags(parseSelectedTags(entry.selectedTags));
          setKeepsake(entry.keepsake === 1);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
