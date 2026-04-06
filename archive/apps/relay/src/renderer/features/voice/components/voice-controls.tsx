import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Volume2 } from 'lucide-react';
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

  const speakDisabled = !canSpeak || isPlaying || !hasVoiceCatalog || selectedVoiceMissing || selectedVoiceInvalid;

  return (
    <div className="flex items-center gap-0.5">
      {/* Mic button */}
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={!canTranscribe}
        title={isRecording ? t('voice.stop') : t('voice.mic')}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          isRecording
            ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]'
            : 'text-[color:var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[color:var(--nimi-text-primary)]'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
      </button>

      {/* Speak button */}
      {lastAssistantText ? (
        <button
          type="button"
          onClick={() => synthesize(lastAssistantText, selectedVoiceId)}
          disabled={speakDisabled}
          title={isPlaying ? t('voice.playing') : t('voice.speak')}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[color:var(--nimi-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Volume2 size={16} />
        </button>
      ) : null}
    </div>
  );
}
