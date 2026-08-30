import { describe, expect, it } from 'vitest';
import { avatarCaptionDurationMs } from './settings-state.js';

describe('avatarCaptionDurationMs', () => {
  it('maps the closed caption duration preference directly to bounded timers', () => {
    expect(avatarCaptionDurationMs('short')).toBe(3_000);
    expect(avatarCaptionDurationMs('standard')).toBe(5_000);
    expect(avatarCaptionDurationMs('long')).toBe(8_000);
  });
});
