import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { OBSERVATION_DIMENSIONS, OBSERVATION_MODES } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import {
  getJournalEntries,
  insertJournalEntryWithTags,
  type JournalEntryRow,
  type JournalTagInsertRow,
} from '../../bridge/sqlite-bridge.js';
import { deleteJournalVoiceAudio, saveJournalVoiceAudio } from '../../bridge/journal-audio-bridge.js';
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

type CaptureMode = 'text' | 'voice';
type VoiceDraftStatus =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'transcribing'
  | 'transcribed'
  | 'transcription-failed';
type TagSuggestionStatus = 'idle' | 'suggesting' | 'ready' | 'failed';

interface VoiceDraft {
  status: VoiceDraftStatus;
  blob: Blob | null;
  mimeType: string | null;
  previewUrl: string | null;
  transcript: string;
  error: string | null;
}

const EMPTY_VOICE_DRAFT: VoiceDraft = {
  status: 'idle',
  blob: null,
  mimeType: null,
  previewUrl: null,
  transcript: '',
  error: null,
};

function describeVoiceStatus(status: VoiceDraftStatus) {
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'ready':
      return 'Ready to transcribe';
    case 'transcribing':
      return 'Transcribing';
    case 'transcribed':
      return 'Ready to save';
    case 'transcription-failed':
      return 'Transcription failed, voice-only save is still available';
    default:
      return 'No voice draft yet';
  }
}

function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  });
}

function parseSelectedTags(selectedTags: string | null) {
  if (!selectedTags) return [];
  try {
    const parsed = JSON.parse(selectedTags) as unknown;
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [];
  } catch {
    return [];
  }
}

export default function JournalPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [entries, setEntries] = useState<JournalEntryRow[]>([]);
  const [activeMode, setActiveMode] = useState<string | null>(null);
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
  const recorderSessionRef = useRef<VoiceRecordingSession | null>(null);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const recordingSupported = supportsVoiceRecording();

  const activeDimensions = useMemo(
    () => getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths),
    [ageMonths],
  );

  const currentDimension = activeDimensions.find((item) => item.dimensionId === selectedDimension) ?? null;

  const draftTextForTagging = captureMode === 'text'
    ? textContent.trim()
    : voiceDraft.transcript.trim();

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
    if (!nextDimension) {
      setSelectedTags([]);
      resetSuggestionMetadata();
      return;
    }

    const allowedTags = new Set(nextDimension.quickTags);
    setSelectedTags((previous) => previous.filter((tag) => allowedTags.has(tag)));
    setConfirmedSuggestion((previous) => {
      if (!previous || previous.dimensionId !== nextDimensionId) {
        return null;
      }
      return {
        dimensionId: previous.dimensionId,
        tags: previous.tags.filter((tag) => allowedTags.has(tag)),
      };
    });
    setTagSuggestionError(null);
    setTagSuggestionStatus((previous) => (previous === 'failed' ? 'idle' : previous));
  };

  const clearVoiceDraft = () => {
    recorderSessionRef.current?.cancel();
    recorderSessionRef.current = null;
    setVoiceDraft((previous) => {
      revokeVoicePreviewUrl(previous.previewUrl);
      return EMPTY_VOICE_DRAFT;
    });
  };

  const resetComposer = () => {
    setCaptureMode('text');
    setTextContent('');
    setActiveMode(null);
    setSelectedDimension(null);
    setSelectedTags([]);
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
    setKeepsake(false);
    setSubmitError(null);
    resetSuggestionMetadata();
    clearVoiceDraft();
  };

  const reloadEntries = async () => {
    if (!child) return;
    setEntries(await getJournalEntries(child.childId, 50));
  };

  useEffect(() => {
    if (!activeChildId) return;
    getJournalEntries(activeChildId, 50).then(setEntries).catch(() => {});
  }, [activeChildId]);

  useEffect(() => {
    setSelectedRecorderId(child?.recorderProfiles?.[0]?.id ?? null);
  }, [child?.childId, child?.recorderProfiles]);

  useEffect(() => {
    hasVoiceTranscriptionRuntime().then(setVoiceRuntimeAvailable).catch(() => {
      setVoiceRuntimeAvailable(false);
    });
    hasJournalTaggingRuntime().then(setTaggingRuntimeAvailable).catch(() => {
      setTaggingRuntimeAvailable(false);
    });
  }, []);

  useEffect(() => () => {
    recorderSessionRef.current?.cancel();
    recorderSessionRef.current = null;
    revokeVoicePreviewUrl(voiceDraft.previewUrl);
  }, [voiceDraft.previewUrl]);

  if (!child) {
    return <div className="p-8 text-gray-500">Add a child profile first.</div>;
  }

  const buildConfirmedAiTags = (): JournalTagInsertRow[] => {
    if (!confirmedSuggestion || !confirmedSuggestion.dimensionId || confirmedSuggestion.dimensionId !== selectedDimension) {
      return [];
    }

    const confirmedTags = confirmedSuggestion.tags.filter((tag) => selectedTags.includes(tag));
    return confirmedTags.map((tag) => ({
      tagId: ulid(),
      domain: 'observation',
      tag,
      source: 'ai',
      confidence: null,
    }));
  };

  const saveJournalEntry = async (payload: {
    entryId: string;
    contentType: string;
    textContent: string | null;
    voicePath: string | null;
    recordedAt: string;
    now: string;
  }) => {
    await insertJournalEntryWithTags({
      entryId: payload.entryId,
      childId: child.childId,
      contentType: payload.contentType,
      textContent: payload.textContent,
      voicePath: payload.voicePath,
      photoPaths: null,
      recordedAt: payload.recordedAt,
      ageMonths,
      observationMode: activeMode,
      dimensionId: selectedDimension,
      selectedTags: selectedTags.length > 0 ? JSON.stringify(selectedTags) : null,
      guidedAnswers: null,
      observationDuration: activeMode === 'five-minute' ? 5 : null,
      keepsake: keepsake ? 1 : 0,
      recorderId: selectedRecorderId,
      aiTags: buildConfirmedAiTags(),
      now: payload.now,
    });
  };

  const handleSubmit = async () => {
    if (!activeMode) return;
    const now = isoNow();
    setSubmitError(null);

    try {
      if (captureMode === 'text') {
        if (!textContent.trim()) return;
        await saveJournalEntry({
          entryId: ulid(),
          contentType: 'text',
          textContent: textContent.trim(),
          voicePath: null,
          recordedAt: now,
          now,
        });
      } else {
        if (!voiceDraft.blob || !voiceDraft.mimeType || voiceDraft.status === 'recording' || voiceDraft.status === 'transcribing') {
          return;
        }

        const entryId = ulid();
        let savedVoicePath: string | null = null;

        try {
          const audioBase64 = await blobToBase64(voiceDraft.blob);
          const savedAudio = await saveJournalVoiceAudio({
            childId: child.childId,
            entryId,
            mimeType: voiceDraft.mimeType,
            audioBase64,
          });
          savedVoicePath = savedAudio.path;

          const payload = resolveVoiceObservationPayload({
            voicePath: savedVoicePath,
            transcript: voiceDraft.transcript,
          });

          await saveJournalEntry({
            entryId,
            contentType: payload.contentType,
            textContent: payload.textContent,
            voicePath: payload.voicePath,
            recordedAt: now,
            now,
          });
        } catch (error) {
          if (savedVoicePath) {
            await deleteJournalVoiceAudio(savedVoicePath).catch(() => {});
          }
          throw error;
        }
      }

      await reloadEntries();
      resetComposer();
    } catch {
      setSubmitError('Save failed. Check the local bridge and runtime state, then try again.');
    }
  };

  const handleStartRecording = async () => {
    setSubmitError(null);
    clearVoiceDraft();
    resetSuggestionMetadata();
    try {
      recorderSessionRef.current = await startVoiceRecording();
      setVoiceDraft({
        status: 'recording',
        blob: null,
        mimeType: null,
        previewUrl: null,
        transcript: '',
        error: null,
      });
    } catch {
      setVoiceDraft({
        ...EMPTY_VOICE_DRAFT,
        status: 'transcription-failed',
        error: 'Could not start recording. Confirm microphone access and try again.',
      });
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
      setVoiceDraft({
        status: 'ready',
        blob: result.blob,
        mimeType: result.mimeType,
        previewUrl: result.previewUrl,
        transcript: '',
        error: null,
      });
    } catch {
      recorderSessionRef.current = null;
      setVoiceDraft({
        ...EMPTY_VOICE_DRAFT,
        status: 'transcription-failed',
        error: 'Recording failed. Please try again.',
      });
    }
  };

  const handleTranscribe = async () => {
    if (!voiceDraft.blob || !voiceDraft.mimeType) return;
    setSubmitError(null);
    setVoiceDraft((previous) => ({
      ...previous,
      status: 'transcribing',
      error: null,
    }));

    try {
      const result = await transcribeVoiceObservation({
        audioBlob: voiceDraft.blob,
        mimeType: voiceDraft.mimeType,
      });
      resetSuggestionMetadata();
      setVoiceDraft((previous) => ({
        ...previous,
        status: 'transcribed',
        transcript: result.transcript,
        error: null,
      }));
    } catch {
      setVoiceDraft((previous) => ({
        ...previous,
        status: 'transcription-failed',
        transcript: '',
        error: 'Transcription failed. You can still save a voice-only journal entry.',
      }));
    }
  };

  const handleSuggestTags = async () => {
    if (!draftTextForTagging) return;

    const candidateDimensions = selectedDimension && currentDimension
      ? [currentDimension]
      : activeDimensions;

    if (candidateDimensions.length === 0) {
      setTagSuggestionStatus('failed');
      setTagSuggestionError('No active observation dimensions are available for this child age.');
      return;
    }

    setTagSuggestionStatus('suggesting');
    setTagSuggestionError(null);

    try {
      const suggestion = await suggestJournalTags({
        draftText: draftTextForTagging,
        candidateDimensions,
      });

      if (suggestion.dimensionId) {
        const suggestedDimension = candidateDimensions.find((item) => item.dimensionId === suggestion.dimensionId);
        const nextTags = suggestion.tags.filter((tag) => suggestedDimension?.quickTags.includes(tag) ?? false);
        applyDimensionSelection(suggestion.dimensionId);
        setSelectedTags((previous) => [...new Set([...previous, ...nextTags])]);
        setConfirmedSuggestion({
          dimensionId: suggestion.dimensionId,
          tags: nextTags,
        });
      } else {
        setConfirmedSuggestion({ dimensionId: null, tags: [] });
      }

      setTagSuggestionStatus('ready');
    } catch {
      setConfirmedSuggestion(null);
      setTagSuggestionStatus('failed');
      setTagSuggestionError('AI tag suggestion failed. Only closed-set local suggestions are allowed, so no tags were applied.');
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag],
    );
  };

  const canSaveText = captureMode === 'text' && textContent.trim().length > 0;
  const canSaveVoice = captureMode === 'voice'
    && Boolean(voiceDraft.blob)
    && voiceDraft.status !== 'recording'
    && voiceDraft.status !== 'transcribing';
  const canSuggestTags = draftTextForTagging.length > 0
    && tagSuggestionStatus !== 'suggesting'
    && taggingRuntimeAvailable !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Observation Journal</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {OBSERVATION_MODES.map((mode) => (
          <button
            key={mode.modeId}
            type="button"
            onClick={() => {
              setSubmitError(null);
              setActiveMode(activeMode === mode.modeId ? null : mode.modeId);
            }}
            className={`rounded-lg border p-4 text-left transition-colors ${
              activeMode === mode.modeId
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="mb-1 text-sm font-semibold">{mode.displayName}</div>
            <div className="text-xs text-gray-500">{mode.duration}</div>
          </button>
        ))}
      </div>

      {activeMode && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium">
                {OBSERVATION_MODES.find((mode) => mode.modeId === activeMode)?.displayName}
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                {OBSERVATION_MODES.find((mode) => mode.modeId === activeMode)?.guidancePrompt}
              </p>
            </div>
            {child.recorderProfiles?.length ? (
              <select
                value={selectedRecorderId ?? ''}
                onChange={(event) => setSelectedRecorderId(event.target.value || null)}
                className="rounded-md border px-2 py-1 text-xs"
              >
                {child.recorderProfiles.map((recorder) => (
                  <option key={recorder.id} value={recorder.id}>
                    {recorder.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="flex gap-2" role="tablist" aria-label="journal capture mode">
            <button
              type="button"
              onClick={() => {
                setCaptureMode('text');
                setSubmitError(null);
                clearVoiceDraft();
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                captureMode === 'text' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => {
                setCaptureMode('voice');
                setSubmitError(null);
                setTextContent('');
                resetSuggestionMetadata();
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                captureMode === 'voice' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Voice
            </button>
          </div>

          {activeDimensions.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-gray-500">Observation dimension (optional)</p>
              <div className="flex flex-wrap gap-1.5">
                {activeDimensions.map((dimension) => (
                  <button
                    key={dimension.dimensionId}
                    type="button"
                    onClick={() =>
                      applyDimensionSelection(
                        selectedDimension === dimension.dimensionId ? null : dimension.dimensionId,
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      selectedDimension === dimension.dimensionId
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {dimension.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentDimension && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="mb-2 text-xs font-medium text-gray-700">Guided questions</p>
              <ul className="space-y-1">
                {currentDimension.guidedQuestions.map((question) => (
                  <li key={question} className="text-xs text-gray-600">
                    - {question}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {currentDimension && currentDimension.quickTags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-gray-500">Quick tags</p>
              <div className="flex flex-wrap gap-1.5">
                {currentDimension.quickTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      selectedTags.includes(tag)
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {captureMode === 'text' ? (
            <textarea
              value={textContent}
              onChange={(event) => {
                setTextContent(event.target.value);
                resetSuggestionMetadata();
              }}
              placeholder="Write what you observed..."
              className="w-full resize-none rounded-md border p-3 text-sm"
              rows={4}
            />
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Voice observation draft</p>
                  <p className="text-xs text-gray-500" data-testid="voice-status">
                    {describeVoiceStatus(voiceDraft.status)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {voiceDraft.status === 'recording' ? (
                    <button
                      type="button"
                      onClick={() => void handleStopRecording()}
                      className="rounded-md bg-red-500 px-3 py-1.5 text-sm text-white"
                    >
                      Stop recording
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleStartRecording()}
                      disabled={!recordingSupported}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      Start recording
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearVoiceDraft}
                    disabled={voiceDraft.status === 'idle'}
                    className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-50"
                  >
                    Delete draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTranscribe()}
                    disabled={
                      !voiceDraft.blob
                      || voiceDraft.status === 'recording'
                      || voiceDraft.status === 'transcribing'
                      || voiceRuntimeAvailable === false
                    }
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {voiceDraft.status === 'transcribing' ? 'Transcribing...' : 'Transcribe'}
                  </button>
                </div>
              </div>

              {!recordingSupported && (
                <p className="text-xs text-red-500">
                  Browser recording is unavailable in this environment. Use the desktop shell and confirm microphone access.
                </p>
              )}

              {voiceRuntimeAvailable === false && (
                <p className="text-xs text-amber-600">
                  Local STT is currently unavailable. You can still save a voice-only observation.
                </p>
              )}

              {voiceDraft.error && (
                <p className="text-xs text-red-500" data-testid="voice-error">
                  {voiceDraft.error}
                </p>
              )}

              {voiceDraft.previewUrl && (
                <audio
                  controls
                  src={voiceDraft.previewUrl}
                  className="w-full"
                  data-testid="voice-preview"
                />
              )}

              {voiceDraft.previewUrl && (
                <textarea
                  value={voiceDraft.transcript}
                  onChange={(event) => {
                    const nextTranscript = event.target.value;
                    resetSuggestionMetadata();
                    setVoiceDraft((previous) => ({
                      ...previous,
                      transcript: nextTranscript,
                      status: nextTranscript.trim().length > 0
                        ? 'transcribed'
                        : previous.status === 'transcribed'
                          ? 'ready'
                          : previous.status,
                    }));
                  }}
                  placeholder="Confirmed transcription stays editable until you save."
                  className="w-full resize-none rounded-md border p-3 text-sm"
                  rows={4}
                />
              )}
            </div>
          )}

          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">AI tag suggestion</p>
                <p className="text-xs text-gray-500">
                  Local-only, closed-set suggestion from the current observation framework.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSuggestTags()}
                disabled={!canSuggestTags}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {tagSuggestionStatus === 'suggesting' ? 'Suggesting...' : 'Suggest tags'}
              </button>
            </div>

            {taggingRuntimeAvailable === false && (
              <p className="text-xs text-amber-600">
                Local AI tagging is unavailable. Manual dimension and tag selection still works.
              </p>
            )}

            {tagSuggestionStatus === 'ready' && confirmedSuggestion?.dimensionId && (
              <p className="text-xs text-emerald-700" data-testid="tag-suggestion-applied">
                Suggested dimension and tags were applied. Review them before saving.
              </p>
            )}

            {tagSuggestionStatus === 'ready' && confirmedSuggestion?.dimensionId === null && (
              <p className="text-xs text-gray-500" data-testid="tag-suggestion-empty">
                The local model did not find enough evidence for a safe closed-set tag suggestion.
              </p>
            )}

            {tagSuggestionError && (
              <p className="text-xs text-red-500" data-testid="tag-suggestion-error">
                {tagSuggestionError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={keepsake}
                onChange={(event) => setKeepsake(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
              />
              Mark as keepsake
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={captureMode === 'text' ? !canSaveText : !canSaveVoice}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {captureMode === 'voice' ? 'Save voice observation' : 'Save'}
              </button>
              <button
                type="button"
                onClick={resetComposer}
                className="rounded-md bg-gray-100 px-4 py-1.5 text-sm text-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>

          {submitError && (
            <p className="text-xs text-red-500" data-testid="journal-submit-error">
              {submitError}
            </p>
          )}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Observation records</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400">No journal entries yet. Pick a mode to start observing.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const dimension = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId);
              const tags = parseSelectedTags(entry.selectedTags);
              const recorderName =
                child.recorderProfiles?.find((item) => item.id === entry.recorderId)?.name ?? null;
              const bodyText = entry.textContent?.trim() || (entry.voicePath ? 'Voice observation saved.' : 'No text content.');

              return (
                <div key={entry.entryId} className="rounded-lg border p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-400">{entry.recordedAt.split('T')[0]}</span>
                    {entry.observationMode ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {entry.observationMode}
                      </span>
                    ) : null}
                    {dimension ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                        {dimension.displayName}
                      </span>
                    ) : null}
                    {entry.voicePath ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        {entry.contentType === 'mixed' ? 'Voice + transcript' : 'Voice'}
                      </span>
                    ) : null}
                    {recorderName ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {recorderName}
                      </span>
                    ) : null}
                    {entry.keepsake === 1 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Keepsake
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-800">{bodyText}</p>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
