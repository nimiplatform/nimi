import {
  createNimiError,
} from '@nimiplatform/sdk/runtime';
import {
  ScenarioJobStatus,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { AgentChatVoiceReferenceMeaning } from './chat-agent-voice-workflow';
import type {
  ChatAgentVoiceWorkflowPollResult,
} from './chat-agent-runtime-types';
import {
  encodeBytesAsDataUrl,
  normalizeText,
} from './chat-agent-runtime-shared';

export function resolveWorkflowJobStatus(status: number): ChatAgentVoiceWorkflowPollResult['workflowStatus'] {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'submitted';
    case ScenarioJobStatus.QUEUED:
      return 'queued';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'complete';
    case ScenarioJobStatus.CANCELED:
      return 'canceled';
    case ScenarioJobStatus.FAILED:
    case ScenarioJobStatus.TIMEOUT:
      return 'failed';
    default:
      return 'submitted';
  }
}

export function toRuntimeVoiceReference(
  reference: AgentChatVoiceReferenceMeaning,
): {
  kind: number;
  reference:
    | { oneofKind: 'presetVoiceId'; presetVoiceId: string }
    | { oneofKind: 'voiceAssetId'; voiceAssetId: string }
    | { oneofKind: 'providerVoiceRef'; providerVoiceRef: string };
} {
  if (reference.kind === 'preset_voice_id') {
    return {
      kind: 1,
      reference: {
        oneofKind: 'presetVoiceId',
        presetVoiceId: reference.stableRef,
      },
    };
  }
  if (reference.kind === 'voice_asset_id') {
    return {
      kind: 2,
      reference: {
        oneofKind: 'voiceAssetId',
        voiceAssetId: reference.stableRef,
      },
    };
  }
  return {
    kind: 3,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef: reference.stableRef,
    },
  };
}

export function resolveVoiceReferenceFromAsset(
  asset: { voiceAssetId?: unknown; providerVoiceRef?: unknown } | null | undefined,
): {
  voiceReference: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
} {
  const voiceAssetId = normalizeText(asset?.voiceAssetId) || null;
  const providerVoiceRef = normalizeText(asset?.providerVoiceRef) || null;
  if (voiceAssetId) {
    return {
      voiceReference: {
        kind: 'voice_asset_id',
        stableRef: voiceAssetId,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  if (providerVoiceRef) {
    return {
      voiceReference: {
        kind: 'provider_voice_ref',
        stableRef: providerVoiceRef,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  return {
    voiceReference: null,
    voiceAssetId,
    providerVoiceRef,
  };
}

export function resolveMediaUrlFromArtifact(input: {
  artifact: { mimeType?: unknown; uri?: unknown; bytes?: Uint8Array | null; artifactId?: unknown } | null | undefined;
  defaultMimeType: string;
  missingArtifactMessage: string;
  missingMediaMessage: string;
  actionHint: string;
}): {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
} {
  const artifact = input.artifact;
  if (!artifact) {
    throw createNimiError({
      message: input.missingArtifactMessage,
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: input.actionHint,
      source: 'runtime',
    });
  }
  const mimeType = normalizeText(artifact.mimeType) || input.defaultMimeType;
  const uri = normalizeText(artifact.uri);
  const bytes = artifact.bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: input.missingMediaMessage,
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: input.actionHint,
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText(artifact.artifactId) || null,
  };
}
