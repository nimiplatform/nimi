import type { ZhiyuEvidence } from './evidence';
import {
  createZhiyuVoicePlaybackController,
  playZhiyuVoiceAudioBytes,
} from '../agent-chat/voice-playback';
import { zhiyuLocalAppRuntimePlatform } from '../local-development/local-app-runtime-platform';

type ZhiyuEvidenceUpdater = (
  update: (current: ZhiyuEvidence) => ZhiyuEvidence,
) => void;

export async function runZhiyuVoicePlaybackAction(
  evidence: ZhiyuEvidence,
  updateEvidence: ZhiyuEvidenceUpdater,
): Promise<void> {
  const controller = createZhiyuVoicePlaybackController({
    subscribeStream: (input) => zhiyuLocalAppRuntimePlatform.agent.subscribeVoiceStream(input),
    readArtifactBytes: (artifactId) => zhiyuLocalAppRuntimePlatform.artifacts.readRuntimeBytes(artifactId),
    playAudioBytes: playZhiyuVoiceAudioBytes,
  });
  try {
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
