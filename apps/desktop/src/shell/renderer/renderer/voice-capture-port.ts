import type {
  AgentVoiceCaptureSession,
  StartAgentVoiceCaptureSessionDeps,
} from '../features/chat/chat-agent-voice-capture.js';

export type DesktopAgentVoiceCaptureOptions = Omit<
  StartAgentVoiceCaptureSessionDeps,
  | 'getUserMediaImpl'
  | 'createMediaRecorderImpl'
  | 'isTypeSupportedImpl'
  | 'createAudioContextImpl'
  | 'setTimeoutImpl'
  | 'clearTimeoutImpl'
  | 'nowImpl'
>;

export interface DesktopRendererVoiceCapturePort {
  start(options: DesktopAgentVoiceCaptureOptions): Promise<AgentVoiceCaptureSession>;
}

export function createUnavailableDesktopRendererVoiceCapturePort(
  reason = 'DESKTOP_RENDERER_VOICE_CAPTURE_UNAVAILABLE',
): DesktopRendererVoiceCapturePort {
  return Object.freeze({
    async start() {
      throw new Error(reason);
    },
  });
}
