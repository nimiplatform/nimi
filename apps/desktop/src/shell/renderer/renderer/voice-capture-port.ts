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
