import React from 'react';
import {
  startAgentVoiceCaptureSession,
  type AgentVoiceCaptureResult,
  type AgentVoiceCaptureSession,
} from '../chat/chat-agent-voice-capture';

const MIC_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Audio recording failed.');
}

function audioExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  return 'webm';
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWavFromAudioBuffer(buffer: AudioBuffer): Uint8Array {
  const channelCount = Math.min(Math.max(buffer.numberOfChannels, 1), 2);
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataByteLength = buffer.length * blockAlign;
  const output = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channelIndex]?.[sampleIndex] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(output);
}

async function decodeAudioBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  const audioContext = new AudioContext();
  try {
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    return await audioContext.decodeAudioData(input);
  } finally {
    void audioContext.close();
  }
}

export async function normalizeRecordedAudioForCloudTranscription(
  result: AgentVoiceCaptureResult,
): Promise<AgentVoiceCaptureResult> {
  const mimeType = result.mimeType.toLowerCase();
  if (!mimeType.includes('webm')) {
    return result;
  }
  const decoded = await decodeAudioBytes(result.bytes);
  return {
    bytes: encodeWavFromAudioBuffer(decoded),
    mimeType: 'audio/wav',
  };
}

export function createRecordedAudioFile(
  result: AgentVoiceCaptureResult,
  basename: string,
): File {
  const mimeType = result.mimeType || 'audio/webm';
  const bytes = new Uint8Array(result.bytes);
  const blob = new Blob([bytes.buffer], { type: mimeType });
  return new File(
    [blob],
    `${basename}-${new Date().toISOString().replace(/[:.]/g, '-')}.${audioExtensionForMimeType(mimeType)}`,
    { type: mimeType },
  );
}

export async function normalizeAudioFileForCloudTranscription(
  file: File,
  basename: string,
): Promise<File> {
  if (!file.type.toLowerCase().includes('webm')) {
    return file;
  }
  const normalized = await normalizeRecordedAudioForCloudTranscription({
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type,
  });
  return createRecordedAudioFile(normalized, basename);
}

export function useTesterAudioRecorder(input: {
  onCaptured: (result: AgentVoiceCaptureResult) => unknown;
  onError: (message: string) => void;
}) {
  const sessionRef = React.useRef<AgentVoiceCaptureSession | null>(null);
  const callbacksRef = React.useRef(input);
  const mountedRef = React.useRef(true);
  const [recording, setRecording] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);

  React.useEffect(() => {
    callbacksRef.current = input;
  }, [input]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);

  const start = React.useCallback(async () => {
    if (sessionRef.current || stopping) {
      return;
    }
    try {
      const session = await startAgentVoiceCaptureSession();
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setRecording(true);
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
    }
  }, [stopping]);

  const stop = React.useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setStopping(true);
    try {
      const result = await session.stop();
      sessionRef.current = null;
      setRecording(false);
      await callbacksRef.current.onCaptured(result);
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error));
    } finally {
      sessionRef.current = null;
      setRecording(false);
      setStopping(false);
    }
  }, []);

  const toggle = React.useCallback(() => {
    if (recording) {
      void stop();
      return;
    }
    void start();
  }, [recording, start, stop]);

  return {
    recording,
    stopping,
    toggle,
  };
}

export function TesterAudioRecordButton(props: {
  recording: boolean;
  stopping: boolean;
  disabled?: boolean;
  label: string;
  stopLabel: string;
  onClick: () => void;
  testId?: string;
}) {
  const label = props.recording ? props.stopLabel : props.label;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.stopping}
      aria-label={label}
      aria-pressed={props.recording}
      title={label}
      data-testid={props.testId}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        props.recording
          ? 'border-[var(--nimi-accent-danger)] bg-[var(--nimi-accent-danger)]/10 text-[var(--nimi-accent-danger)] hover:bg-[var(--nimi-accent-danger)]/15'
          : 'border-transparent text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-subtle)] hover:bg-[var(--nimi-surface-canvas)] hover:text-[var(--nimi-text-secondary)]'
      }`}
    >
      {MIC_ICON}
      {props.recording ? (
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--nimi-accent-danger)] ring-2 ring-[var(--nimi-surface-card)] ${
            props.stopping ? 'animate-pulse' : ''
          }`}
        />
      ) : null}
    </button>
  );
}
