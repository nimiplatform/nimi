import { describe, expect, it } from 'vitest';
import {
  buildClassificationPairsFromAuthority,
  CLASSIFICATION_PAIRS,
  getClassification,
  isValidPair,
} from './classification.js';

describe('ShiJi content classification authority', () => {
  it('derives student-facing labels from the content-classification authority table', () => {
    expect(CLASSIFICATION_PAIRS).toEqual([
      { contentType: 'history', truthMode: 'factual', badge: '历史 / 史实', contentLabel: '历史', truthLabel: '史实' },
      { contentType: 'literature', truthMode: 'dramatized', badge: '名著 / 演义', contentLabel: '名著', truthLabel: '演义' },
      { contentType: 'mythology', truthMode: 'legendary', badge: '神话 / 传说', contentLabel: '神话', truthLabel: '传说' },
    ]);

    expect(getClassification('history', 'factual')?.badge).toBe('历史 / 史实');
    expect(isValidPair('history', 'legendary')).toBe(false);
  });

  it('fails closed when an allowed pair is not backed by concrete labels', () => {
    const invalidAuthority = `
content_types:
  - key: history
    display_label: 历史
truth_modes:
  - key: factual
    display_label: 史实
allowed_pairs:
  - contentType: literature
    truthMode: factual
    ui_badge: 名著 / 史实
`;

    expect(() => buildClassificationPairsFromAuthority(invalidAuthority)).toThrow(
      'missing content label for literature',
    );
  });
});
