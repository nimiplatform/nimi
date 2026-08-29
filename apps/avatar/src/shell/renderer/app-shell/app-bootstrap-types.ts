import type { AvatarDebugFacade } from '../avatar-debug/contract.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';

export type AvatarCommittedPresentationActivation = {
  readonly agentHandle: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

export type BootstrapHandle = {
  driver?: AgentDataDriver | null;
  carrier?: AvatarRuntimeCarrier | null;
  getVoiceInputAvailability(input: {
    agentHandle: string;
    conversationAnchorId: string;
  }): Promise<{
    available: boolean;
    reason: string | null;
  }>;
  startVoiceCapture(input: {
    agentHandle: string;
    conversationAnchorId: string;
    onLevelChange?: (amplitude: number) => void;
  }): Promise<AvatarVoiceCaptureSession>;
  submitVoiceCaptureTurn(input: {
    agentHandle: string;
    conversationAnchorId: string;
    audioBytes: Uint8Array;
    mimeType: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{
    transcript: string;
  }>;
  interruptConversationTurn(input: {
    agentHandle: string;
    conversationAnchorId: string;
    turnId?: string;
    reason?: string;
  }): Promise<void>;
  sendConversationText(input: {
    agentHandle: string;
    conversationAnchorId: string;
    text: string;
  }): Promise<{ readonly turnId: string }>;
  activateCommittedPresentation(
    input: AvatarCommittedPresentationActivation,
  ): Promise<void>;
  avatarDebug: AvatarDebugFacade | null;
  shutdown(): Promise<void>;
};
