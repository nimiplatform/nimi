import { describe, expect, it } from 'vitest';
import { resolveVoiceObservationPayload } from './voice-observation.js';

describe('resolveVoiceObservationPayload', () => {
  it('produces a voice payload when no transcript is confirmed', () => {
    expect(resolveVoiceObservationPayload({
      voicePath: 'C:/voice/entry-1.webm',
      transcript: '',
    })).toEqual({
      contentType: 'voice',
      textContent: null,
      voicePath: 'C:/voice/entry-1.webm',
    });
  });

  it('produces a mixed payload when transcript text exists', () => {
    expect(resolveVoiceObservationPayload({
      voicePath: 'C:/voice/entry-1.webm',
      transcript: 'Observed focused play.',
    })).toEqual({
      contentType: 'mixed',
      textContent: 'Observed focused play.',
      voicePath: 'C:/voice/entry-1.webm',
    });
  });

  it('fails closed when voicePath is missing', () => {
    expect(() => resolveVoiceObservationPayload({
      voicePath: null,
      transcript: 'hello',
    })).toThrow(/voicePath/);
  });
});
