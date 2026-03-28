import { describe, expect, it } from 'vitest';
import { deriveCorrectionHints, parseEvaluationJson, validateEvaluation } from './evaluation.js';

describe('lookdev evaluation helpers', () => {
  it('parses valid evaluation payloads and keeps shape', () => {
    const result = parseEvaluationJson(JSON.stringify({
      passed: true,
      score: 86,
      checks: [
        { key: 'fullBody', passed: true },
        { key: 'fixedFocalLength', passed: true },
        { key: 'subjectClarity', passed: true },
        { key: 'stablePose', passed: true },
        { key: 'backgroundSubordinate', passed: true },
        { key: 'lowOcclusion', passed: true },
      ],
      summary: 'Reads like a clean anchor portrait.',
      failureReasons: [],
    }));

    expect(result.passed).toBe(true);
    expect(result.score).toBe(86);
    expect(result.checks).toHaveLength(6);
  });

  it('forces failure when any hard gate fails', () => {
    const validated = validateEvaluation({
      passed: true,
      score: 95,
      checks: [
        { key: 'fullBody', passed: false, kind: 'hard_gate' },
        { key: 'fixedFocalLength', passed: true, kind: 'hard_gate' },
        { key: 'subjectClarity', passed: true, kind: 'hard_gate' },
      ],
      summary: 'Body crop failed.',
      failureReasons: ['Feet are cropped.'],
    }, 78);

    expect(validated.passed).toBe(false);
  });

  it('derives correction hints from failed checks and reasons', () => {
    const hints = deriveCorrectionHints({
      passed: false,
      score: 61,
      checks: [
        { key: 'fullBody', passed: false, kind: 'hard_gate' },
        { key: 'backgroundSubordinate', passed: false, kind: 'scored' },
      ],
      summary: 'Background is too heavy.',
      failureReasons: ['Keep the feet visible.'],
    });

    expect(hints.join(' ')).toContain('entire character visible');
    expect(hints.join(' ')).toContain('Subdue the background');
    expect(hints).toContain('Keep the feet visible.');
  });
});
