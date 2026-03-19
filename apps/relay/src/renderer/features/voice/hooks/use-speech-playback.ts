// RL-FEAT-003 — Voice (TTS)
// RL-CORE-002 — Agent voice profile determines default model + voiceId
// RL-FEAT-005 — Lip sync: TTS audio volume → Live2D ParamMouthOpenY

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { useLipSyncBridge } from '../../buddy/live2d/lip-sync-bridge.js';

export function useSpeechPlayback() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // RL-CORE-002: Cancel playback when agent changes
  useEffect(() => {
    return () => {
      sourceRef.current?.stop();
      sourceRef.current = null;
      useLipSyncBridge.getState().setMouthTarget(0);
    };
  }, [currentAgent?.id]);

  const synthesize = useCallback(async (text: string, voiceId?: string) => {
    if (!currentAgent || !runtimeAvailable) return;

    const bridge = getBridge();
    setIsPlaying(true);

    try {
      // RL-CORE-004: agentId in input
      // RL-CORE-002: model + voiceId from agent profile (overridable via voiceId param)
      const result = await bridge.media.tts.synthesize({
        agentId: currentAgent.id,
        text,
        model: currentAgent.voiceModel || '',
        voiceId: voiceId ?? currentAgent.voiceId,
      });

      if (result.audio) {
        await playBase64AudioWithLipSync(result.audio, audioContextRef, sourceRef);
      }
    } finally {
      setIsPlaying(false);
      useLipSyncBridge.getState().setMouthTarget(0);
    }
  }, [currentAgent, runtimeAvailable]);

  return { synthesize, isPlaying, canSpeak: !!currentAgent && runtimeAvailable };
}

async function playBase64AudioWithLipSync(
  base64: string,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
  sourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
): Promise<void> {
  const audioContext = audioContextRef.current ?? new AudioContext();
  audioContextRef.current = audioContext;

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  sourceRef.current = source;

  // RL-FEAT-005: Create AnalyserNode to extract volume for lip sync
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let rafId: number | null = null;

  function pumpVolume() {
    analyser.getByteFrequencyData(dataArray);
    // Average volume normalized to 0..1
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const volume = Math.min(1, (sum / dataArray.length) / 128);
    useLipSyncBridge.getState().setMouthTarget(volume);
    rafId = requestAnimationFrame(pumpVolume);
  }

  rafId = requestAnimationFrame(pumpVolume);

  return new Promise<void>((resolve) => {
    source.onended = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      useLipSyncBridge.getState().setMouthTarget(0);
      sourceRef.current = null;
      resolve();
    };
    source.start();
  });
}
