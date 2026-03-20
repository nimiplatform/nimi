import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSpeechTranscribe } from '../hooks/use-speech-transcribe.js';
import { useSpeechPlayback, resolveSpeakVoiceId } from '../hooks/use-speech-playback.js';
import { useListVoices, type Voice } from '../hooks/use-list-voices.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { useSettingsStore } from '../../../app-shell/providers/settings-store.js';

interface VoiceControlsProps {
  onTranscript?: (text: string) => void;
  lastAssistantText?: string;
}

export function isSelectedVoiceSupported(selectedVoiceId: string | undefined, voices: Voice[]): boolean {
  if (!selectedVoiceId) {
    return true;
  }
  return voices.some((voice) => voice.voiceId === selectedVoiceId);
}

export function VoiceControls({ onTranscript, lastAssistantText }: VoiceControlsProps) {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const { inspect, updateInspect } = useSettingsStore();
  const { isRecording, transcript, startRecording, stopRecording, canTranscribe } =
    useSpeechTranscribe();
  const { synthesize, isPlaying, canSpeak, error: playbackError, clearError } = useSpeechPlayback();
  const { voices, isLoading: voicesLoading, error: voicesError } = useListVoices({
    connectorId: inspect.ttsConnectorId,
    model: inspect.ttsModel,
    runtimeAvailable,
  });
  const prevTranscriptRef = useRef('');
  const selectedVoiceId = useMemo(
    () => resolveSpeakVoiceId(inspect.ttsVoiceId),
    [inspect.ttsVoiceId],
  );
  const hasVoiceCatalog = inspect.ttsConnectorId.trim().length > 0 && inspect.ttsModel.trim().length > 0;
  const selectedVoiceMissing = hasVoiceCatalog && !selectedVoiceId;
  const selectedVoiceInvalid = hasVoiceCatalog
    && Boolean(selectedVoiceId)
    && voices.length > 0
    && !isSelectedVoiceSupported(selectedVoiceId, voices);

  // Feed transcript into chat when it changes
  useEffect(() => {
    if (transcript && transcript !== prevTranscriptRef.current && onTranscript) {
      onTranscript(transcript);
      prevTranscriptRef.current = transcript;
    }
  }, [transcript, onTranscript]);

  useEffect(() => {
    clearError();
  }, [clearError, inspect.ttsConnectorId, inspect.ttsModel, inspect.ttsVoiceId]);

  const statusMessage = selectedVoiceMissing
    ? t('voice.selectPrompt', 'Select a voice for the current TTS model before using Speak.')
    : !hasVoiceCatalog
      ? t('voice.ttsRouteRequired', 'Select a TTS connector and model in Settings before using Speak.')
    : selectedVoiceInvalid
      ? t('voice.invalidSelection', 'Current voice is not available for this TTS model. Please reselect a voice in Settings.')
      : playbackError || voicesError;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={!canTranscribe}
        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors duration-150 ${
          isRecording
            ? 'bg-error text-white hover:bg-error/80'
            : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
        } disabled:opacity-50`}
      >
        {isRecording ? t('voice.stop') : t('voice.mic')}
      </button>

      {/* RL-FEAT-003: Voice selector */}
      {voices.length > 0 && (
        <select
          value={selectedVoiceId ?? ''}
          onChange={(e) => updateInspect({ ttsVoiceId: e.target.value })}
          disabled={voicesLoading}
          className="px-2 py-1 rounded-lg text-[11px] bg-bg-elevated text-text-secondary border border-border-subtle outline-none focus:border-accent disabled:opacity-50"
        >
          {!selectedVoiceId && (
            <option value="">{t('voice.select', 'Select a voice...')}</option>
          )}
          {voices.map((v) => (
            <option key={v.voiceId} value={v.voiceId}>
              {v.name || v.voiceId}
            </option>
          ))}
        </select>
      )}

      {lastAssistantText && (
        <button
          onClick={() => synthesize(lastAssistantText, selectedVoiceId)}
          disabled={!canSpeak || isPlaying || !hasVoiceCatalog || selectedVoiceMissing || selectedVoiceInvalid}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors duration-150 disabled:opacity-50"
        >
          {isPlaying ? t('voice.playing') : t('voice.speak')}
        </button>
      )}

      {statusMessage && (
        <span className="text-[10px] text-warning max-w-[200px] truncate" title={statusMessage}>
          {statusMessage}
        </span>
      )}
    </div>
  );
}
