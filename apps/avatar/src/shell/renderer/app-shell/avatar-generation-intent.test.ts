import { describe, expect, it } from 'vitest';
import { buildAvatarSpeechTranscriptionSubmitRequest } from './avatar-generation-intent.js';

describe('Avatar canonical generation intent', () => {
  it('submits speech transcription without App-owned target, model, connector, or binding input', () => {
    const request = buildAvatarSpeechTranscriptionSubmitRequest({
      subjectUserId: 'account-1',
      mimeType: 'audio/webm',
      audioBytes: new Uint8Array([1, 2, 3]),
      language: 'en',
      requestId: 'avatar-stt-request',
      idempotencyKey: 'avatar-stt-idempotency',
    });

    expect(request.head).toMatchObject({
      appId: 'nimi.avatar',
      subjectUserId: 'account-1',
      modelId: '',
      connectorId: '',
      routePolicy: 0,
    });
    expect(request.head?.targetRef).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain('executionBinding');
    expect(JSON.stringify(request)).not.toContain('resolvedBinding');
  });
});
