import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiSpeechTranscriptionScenario,
} from '@nimiplatform/sdk/features/generation';

export const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';

/**
 * Builds Avatar speech intent from request identity and scenario content only.
 */
export function buildAvatarSpeechTranscriptionSubmitRequest(input: {
  readonly subjectUserId: string;
  readonly mimeType: string;
  readonly audioBytes: Uint8Array;
  readonly language?: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
}) {
  return buildNimiRuntimeGenerationSubmitRequest({
    appId: AVATAR_FIRST_PARTY_APP_ID,
    subjectUserId: input.subjectUserId,
    timeoutMs: 90_000,
  }, {
    scenario: createNimiSpeechTranscriptionScenario({
      kind: 'speech-transcribe',
      mimeType: input.mimeType,
      audio: { type: 'bytes', bytes: input.audioBytes },
      ...(input.language ? { language: input.language } : {}),
    }),
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  });
}
