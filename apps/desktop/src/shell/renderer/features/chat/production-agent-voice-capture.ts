import {
  startAgentVoiceCaptureSession,
  type AudioContextLike,
  type MediaRecorderLike,
  type MediaStreamLike,
} from './chat-agent-voice-capture.js';
import type {
  DesktopAgentVoiceCaptureOptions,
  DesktopRendererVoiceCapturePort,
} from '../../renderer/voice-capture-port.js';

export function createDesktopProductionVoiceCapturePort(): DesktopRendererVoiceCapturePort {
  return Object.freeze({
    start(options: DesktopAgentVoiceCaptureOptions) {
      const AudioContextConstructor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Voice input is unavailable because microphone capture is not supported.');
      }
      return startAgentVoiceCaptureSession({
        ...options,
        getUserMediaImpl: (constraints) => navigator.mediaDevices.getUserMedia(constraints) as unknown as Promise<MediaStreamLike>,
        createMediaRecorderImpl: (stream, recorderOptions) => (
          new MediaRecorder(stream as MediaStream, recorderOptions) as unknown as MediaRecorderLike
        ),
        isTypeSupportedImpl: MediaRecorder.isTypeSupported.bind(MediaRecorder),
        createAudioContextImpl: AudioContextConstructor
          ? () => new AudioContextConstructor() as unknown as AudioContextLike
          : undefined,
        setTimeoutImpl: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
        clearTimeoutImpl: (timerId) => window.clearTimeout(timerId as number),
        nowImpl: Date.now,
      });
    },
  });
}
