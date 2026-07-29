import type { ZhiyuEvidence } from './evidence';
import { requireZhiyuLocalAppCapability } from '../auth/runtime-platform';

type ZhiyuEvidenceUpdater = (
  update: (current: ZhiyuEvidence) => ZhiyuEvidence,
) => void;

export async function runZhiyuVoicePlaybackAction(
  evidence: ZhiyuEvidence,
  updateEvidence: ZhiyuEvidenceUpdater,
): Promise<void> {
  try {
    void evidence;
    requireZhiyuLocalAppCapability('voice-playback');
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
