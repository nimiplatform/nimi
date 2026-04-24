import { describe, expect, it } from 'vitest';
import { defaultModelConfigProfileCopy } from '../src/default-profile-copy.js';
import type { ModelConfigProfileCopy } from '../src/types.js';

describe('defaultModelConfigProfileCopy', () => {
  it('fully populates every ModelConfigProfileCopy field from ModelConfig.profile.* namespace', () => {
    const seen: string[] = [];
    const copy: ModelConfigProfileCopy = defaultModelConfigProfileCopy((key) => {
      seen.push(key);
      return key;
    });
    const requiredKeys: Array<keyof ModelConfigProfileCopy> = [
      'sectionTitle',
      'summaryLabel',
      'emptySummaryLabel',
      'applyButtonLabel',
      'changeButtonLabel',
      'manageButtonTitle',
      'modalTitle',
      'modalHint',
      'loadingLabel',
      'emptyLabel',
      'currentBadgeLabel',
      'cancelLabel',
      'confirmLabel',
      'applyingLabel',
      'reloadLabel',
      'importLabel',
    ];
    for (const key of requiredKeys) {
      const value = copy[key];
      expect(value, `${String(key)} must be populated`).toBeTruthy();
      expect(String(value).startsWith('ModelConfig.profile.'), `${String(key)} must reference ModelConfig.profile namespace`).toBe(true);
    }
    for (const requestedKey of seen) {
      expect(requestedKey.startsWith('ModelConfig.profile.')).toBe(true);
    }
  });
});
