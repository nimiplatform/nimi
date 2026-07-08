import type {
  GetAvatarDebugSnapshotResponse,
  ListAvatarDebugProbeResultsResponse,
  NimiRuntimeAgentCompanionParticipationProjection,
  RequestAvatarDebugProbeResponse,
} from '@nimiplatform/sdk/runtime';
import type { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/wire-types';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';

export type BootstrapHandle = {
  driver?: AgentDataDriver | null;
  carrier?: AvatarRuntimeCarrier | null;
  getVoiceInputAvailability(input: {
    agentId: string;
    conversationAnchorId: string;
  }): Promise<{
    available: boolean;
    reason: string | null;
  }>;
  startVoiceCapture(input: {
    agentId: string;
    conversationAnchorId: string;
    onLevelChange?: (amplitude: number) => void;
  }): Promise<AvatarVoiceCaptureSession>;
  submitVoiceCaptureTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    audioBytes: Uint8Array;
    mimeType: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{
    transcript: string;
  }>;
  cancelCompanionParticipation(input: {
    agentId: string;
    conversationAnchorId: string;
    projectionId?: string;
    turnId?: string;
    reason?: string;
  }): Promise<NimiRuntimeAgentCompanionParticipationProjection>;
  interruptActiveTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    turnId?: string;
    reason?: string;
  }): Promise<void>;
  requestCompanionParticipation(input: {
    agentId: string;
    conversationAnchorId: string;
    text: string;
  }): Promise<NimiRuntimeAgentCompanionParticipationProjection>;
  avatarDebug: {
    snapshot(input: {
      agentId: string;
      conversationAnchorId: string;
    }): Promise<GetAvatarDebugSnapshotResponse>;
    requestProbe(input: {
      agentId: string;
      conversationAnchorId: string;
      probeKind: AvatarDebugProbeKind;
      avatarInstanceId?: string | null;
    }): Promise<RequestAvatarDebugProbeResponse>;
    listProbeResults(input: {
      agentId: string;
      conversationAnchorId: string;
      probeKind?: AvatarDebugProbeKind;
    }): Promise<ListAvatarDebugProbeResultsResponse>;
  } | null;
  shutdown(): Promise<void>;
};
