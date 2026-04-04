export type VoiceObservationContentType = 'voice' | 'mixed';

export function resolveVoiceObservationPayload(input: {
  voicePath: string | null;
  transcript: string | null;
}): {
  contentType: VoiceObservationContentType;
  textContent: string | null;
  voicePath: string;
} {
  const voicePath = input.voicePath?.trim() ?? '';
  if (!voicePath) {
    throw new Error('voice observation requires a saved voicePath');
  }

  const transcript = input.transcript?.trim() ?? '';
  if (transcript.length === 0) {
    return {
      contentType: 'voice',
      textContent: null,
      voicePath,
    };
  }

  return {
    contentType: 'mixed',
    textContent: transcript,
    voicePath,
  };
}
