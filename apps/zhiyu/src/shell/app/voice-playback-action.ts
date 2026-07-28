import type { ZhiyuEvidence } from './evidence';
import {
  createZhiyuVoicePlaybackController,
  playZhiyuVoiceAudioBytes,
} from '../agent-chat/voice-playback';
import { createNimiRuntimeAgentVoiceModule } from '@nimiplatform/sdk/runtime';
import { appId, getRuntimePlatformProjection } from '../auth/runtime-platform';
import {
  createZhiyuRuntimeAgentAccessScopeRunner,
  resolveZhiyuRuntimeAgentAccessDecisionFromHost,
  withZhiyuRuntimeAgentAccess,
} from '../agent-chat/runtime-agent-access';

type ZhiyuEvidenceUpdater = (
  update: (current: ZhiyuEvidence) => ZhiyuEvidence,
) => void;

export async function runZhiyuVoicePlaybackAction(
  evidence: ZhiyuEvidence,
  updateEvidence: ZhiyuEvidenceUpdater,
): Promise<void> {
  try {
    const runtimeProjection = await getRuntimePlatformProjection();
    if (runtimeProjection.status !== 'ready') {
      throw Object.assign(new Error(runtimeProjection.message), {
        reasonCode: runtimeProjection.reasonCode,
        actionHint: runtimeProjection.actionHint || 'start_external_runtime_daemon',
        source: 'runtime',
      });
    }
    const runtimeAccess = resolveZhiyuRuntimeAgentAccessDecisionFromHost();
    if (runtimeAccess.kind === 'missing') {
      throw Object.assign(new Error(runtimeAccess.message), {
        reasonCode: runtimeAccess.reasonCode,
        actionHint: runtimeAccess.actionHint,
        source: 'runtime',
      });
    }
    const ownerUserId = requiredText(evidence.conversation.ownerUserId, 'runtime-voice-owner-required');
    const runtimeSourceRef = requiredText(evidence.conversation.runtimeSourceRef, 'runtime-voice-source-required');
    const voice = createNimiRuntimeAgentVoiceModule({
      runtime: {
        appId,
        auth: runtimeProjection.accountRuntime.auth,
        agents: runtimeProjection.accountRuntime.agents,
        artifacts: runtimeProjection.accountRuntime.artifacts,
      },
      getSubjectUserId: () => ownerUserId,
      withScopes: createZhiyuRuntimeAgentAccessScopeRunner(() => runtimeAccess),
    });
    const controller = createZhiyuVoicePlaybackController({
      subscribeStream: (input) => voice.subscribeStream({
        ownerUserId,
        runtimeSourceRef,
        localAgentRef: input.agentId,
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.turnId,
        voiceStreamId: input.voiceStreamId,
      }),
      readArtifactBytes: (artifactId) => withZhiyuRuntimeAgentAccess(
        runtimeAccess,
        (options) => voice.replayFinalArtifact({ artifactId }, options),
      ),
      playAudioBytes: playZhiyuVoiceAudioBytes,
    });
    const result = await controller.run({
      voiceOutputMode: evidence.companion.voiceOutputMode,
      voicePlaybackState: evidence.companion.voicePlaybackState,
      voiceAudioArtifactId: evidence.companion.voiceAudioArtifactId,
      voiceAudioMimeType: evidence.companion.voiceAudioMimeType,
      voiceStreamId: evidence.companion.voiceStreamId,
      agentId: evidence.conversation.localAgentRef,
      conversationAnchorId: evidence.conversation.conversationAnchorId,
      turnId: evidence.turn.runtimeTurnId,
    });
    if (result.violation) {
      throw Object.assign(new Error(result.reasonCode), {
        reasonCode: result.reasonCode,
        actionHint: result.actionHint,
        source: 'renderer',
      });
    }
  } catch (error) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const reasonCode = typeof record.reasonCode === 'string'
      ? record.reasonCode
      : 'runtime-voice-playback-failed';
    const actionHint = typeof record.actionHint === 'string'
      ? record.actionHint
      : 'retry_runtime_voice_playback';
    updateEvidence((current) => ({
      ...current,
      companion: {
        ...current.companion,
        ready: false,
        state: 'blocked',
        reasonCode,
        actionHint,
        source: 'renderer',
        message: error instanceof Error ? error.message : 'Runtime voice playback failed.',
      },
    }));
  }
}

function requiredText(value: unknown, reasonCode: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text) return text;
  throw Object.assign(new Error(reasonCode), {
    reasonCode,
    actionHint: 'refresh_runtime_conversation_anchor',
    source: 'runtime',
  });
}
