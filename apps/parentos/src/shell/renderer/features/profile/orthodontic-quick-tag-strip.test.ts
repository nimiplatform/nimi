import { describe, expect, it } from 'vitest';
import {
  quickTagClinicalEventPrefill,
  quickTagLabel,
  type OrthodonticQuickTagId,
} from './orthodontic-quick-tag-strip.js';

describe('quickTagClinicalEventPrefill', () => {
  // Device-class tags read as "装置X" so the parent doesn't have to
  // retype the chip label into the notes field.
  it('emits the device-class prefix for fall and break', () => {
    expect(quickTagClinicalEventPrefill('fall')).toBe('装置脱落');
    expect(quickTagClinicalEventPrefill('break')).toBe('装置断裂');
  });

  // Symptom-class tags read as "症状: X".
  it('emits the symptom-class prefix for pain and swell', () => {
    expect(quickTagClinicalEventPrefill('pain')).toBe('症状: 疼痛');
    expect(quickTagClinicalEventPrefill('swell')).toBe('症状: 肿胀');
  });

  // The free-form chip carries an empty (not null!) string so the page
  // controller can distinguish it from the routing-to-unwear-form case.
  it('emits an empty prefill for the free-form note chip', () => {
    expect(quickTagClinicalEventPrefill('note')).toBe('');
  });

  // The "miss" chip is special: it routes to the un-wear backfill form,
  // not the clinical event modal. Returning `null` is the discriminator.
  it('returns null for miss so the page routes to the un-wear backfill form', () => {
    expect(quickTagClinicalEventPrefill('miss')).toBeNull();
  });

  // Exhaustiveness check — if a future tag is added to the union without
  // updating this function, TypeScript prevents that change from
  // compiling, but a runtime sanity check catches an accidental cast.
  it('covers every admitted tag id', () => {
    const ids: OrthodonticQuickTagId[] = [
      'fall',
      'break',
      'miss',
      'pain',
      'swell',
      'note',
    ];
    for (const id of ids) {
      // Either a string (with or without content) or null. Anything else
      // means the switch fell through.
      const result = quickTagClinicalEventPrefill(id);
      expect(result === null || typeof result === 'string').toBe(true);
    }
  });
});

describe('quickTagLabel', () => {
  it('returns the visible chip text per admitted id', () => {
    expect(quickTagLabel('fall')).toBe('脱落');
    expect(quickTagLabel('break')).toBe('断裂');
    expect(quickTagLabel('miss')).toBe('漏戴');
    expect(quickTagLabel('pain')).toBe('疼痛');
    expect(quickTagLabel('swell')).toBe('肿胀');
    expect(quickTagLabel('note')).toBe('其他');
  });

  it('falls back to the raw id when handed an unknown value', () => {
    // The function takes the admitted union, so this can only happen via
    // a runtime cast. The fallback prevents a `.label` lookup on undefined.
    expect(quickTagLabel('phantom' as OrthodonticQuickTagId)).toBe('phantom');
  });
});
