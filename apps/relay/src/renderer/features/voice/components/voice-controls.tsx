import { useEffect, useRef, useState } from 'react';
import { useSpeechTranscribe } from '../hooks/use-speech-transcribe.js';
import { useSpeechPlayback } from '../hooks/use-speech-playback.js';
import { useListVoices } from '../hooks/use-list-voices.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

interface VoiceControlsProps {
  onTranscript?: (text: string) => void;
  lastAssistantText?: string;
}

export function VoiceControls({ onTranscript, lastAssistantText }: VoiceControlsProps) {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const { isRecording, transcript, startRecording, stopRecording, canTranscribe } =
    useSpeechTranscribe();
  const { synthesize, isPlaying, canSpeak } = useSpeechPlayback();
  const { voices, isLoading: voicesLoading } = useListVoices();
  const prevTranscriptRef = useRef('');

  // RL-FEAT-003: Track selected voice — default to agent profile voiceId
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>(
    currentAgent?.voiceId,
  );

  // Reset selected voice when agent changes
  useEffect(() => {
    setSelectedVoiceId(currentAgent?.voiceId);
  }, [currentAgent?.id, currentAgent?.voiceId]);

  // Feed transcript into chat when it changes
  useEffect(() => {
    if (transcript && transcript !== prevTranscriptRef.current && onTranscript) {
      onTranscript(transcript);
      prevTranscriptRef.current = transcript;
    }
  }, [transcript, onTranscript]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={!canTranscribe}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
          isRecording
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        } disabled:opacity-50`}
      >
        {isRecording ? 'Stop' : 'Mic'}
      </button>

      {/* RL-FEAT-003: Voice selector — browse available voices */}
      {voices.length > 0 && (
        <select
          value={selectedVoiceId ?? ''}
          onChange={(e) => setSelectedVoiceId(e.target.value || undefined)}
          disabled={voicesLoading}
          className="px-2 py-1.5 rounded-lg text-xs bg-gray-700 text-gray-300 border-none outline-none disabled:opacity-50"
        >
          {currentAgent?.voiceId && !voices.some((v) => v.voiceId === currentAgent.voiceId) && (
            <option value={currentAgent.voiceId}>Default</option>
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
          disabled={!canSpeak || isPlaying}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50"
        >
          {isPlaying ? 'Playing...' : 'Speak'}
        </button>
      )}
    </div>
  );
}
