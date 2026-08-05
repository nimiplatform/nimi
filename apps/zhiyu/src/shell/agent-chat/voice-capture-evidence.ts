export type ZhiyuVoiceCaptureState = 'idle' | 'recording' | 'transcribing' | 'failed';

export type ZhiyuVoiceCaptureEvidence = {
  readonly transport: 'electron-media-recorder';
  readonly state: ZhiyuVoiceCaptureState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly transcriptText: string;
  readonly transcriptLength: number;
};

export function createInitialZhiyuVoiceCaptureEvidence(): ZhiyuVoiceCaptureEvidence {
  return voiceCaptureEvidence({
    state: 'idle',
    reasonCode: 'runtime-voice-capture-idle',
    actionHint: 'start_voice_capture',
    source: 'renderer',
    message: 'Voice capture is idle.',
  });
}

export function voiceCaptureEvidence(input: Partial<ZhiyuVoiceCaptureEvidence>): ZhiyuVoiceCaptureEvidence {
  return {
    transport: 'electron-media-recorder',
    state: input.state ?? 'idle',
    reasonCode: input.reasonCode ?? 'runtime-voice-capture-idle',
    actionHint: input.actionHint ?? 'start_voice_capture',
    source: input.source ?? 'renderer',
    message: input.message ?? 'Voice capture is idle.',
    requestId: input.requestId ?? null,
    transcriptText: input.transcriptText ?? '',
    transcriptLength: input.transcriptLength ?? 0,
  };
}
