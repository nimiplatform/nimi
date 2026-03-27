import { describe, expect, it } from 'vitest';

import { isAuthFormSubmittable } from '../auth/src/logic/auth-form-state.js';

describe('isAuthFormSubmittable', () => {
  it('rejects whitespace-only passwords', () => {
    expect(isAuthFormSubmittable('user@example.com', '   ')).toBe(false);
  });

  it('accepts trimmed non-empty credentials', () => {
    expect(isAuthFormSubmittable('  user@example.com  ', '  secret  ')).toBe(true);
  });
});
