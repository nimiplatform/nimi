// RL-FEAT-004 — Voice (STT)
// Note: STT is agent-independent (RL-CORE-002 exception)
// Transcription itself has no agent affinity; consumption feeds into RL-FEAT-001

import { useState, useCallback, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export function useSpeechTranscribe() {
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    if (!runtimeAvailable) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const base64 = await blobToBase64(blob);

      const bridge = getBridge();
      try {
        // STT is agent-independent — no agentId needed
        const result = await bridge.media.stt.transcribe({
          audio: base64,
          format: 'webm',
        }) as { text?: string };
        setTranscript(result.text || '');
      } catch {
        setTranscript('');
      }

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    setIsRecording(true);
  }, [runtimeAvailable]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    transcript,
    startRecording,
    stopRecording,
    canTranscribe: runtimeAvailable,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64 || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
