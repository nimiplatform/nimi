import { describe, expect, it } from 'vitest';
import { detectVideoFoodMapIntakeTarget } from './intake.js';

describe('detectVideoFoodMapIntakeTarget', () => {
  it('recognizes bilibili video links', () => {
    expect(
      detectVideoFoodMapIntakeTarget('https://www.bilibili.com/video/BV1xx411c7mD'),
    ).toMatchObject({
      kind: 'video',
      normalizedUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    });
  });

  it('recognizes bilibili creator pages', () => {
    expect(
      detectVideoFoodMapIntakeTarget('space.bilibili.com/123456'),
    ).toMatchObject({
      kind: 'creator',
      normalizedUrl: 'https://space.bilibili.com/123456',
    });
  });

  it('treats empty input as invalid', () => {
    expect(detectVideoFoodMapIntakeTarget('   ').kind).toBe('invalid');
  });

  it('rejects unsupported links', () => {
    expect(
      detectVideoFoodMapIntakeTarget('https://example.com/video/123'),
    ).toMatchObject({
      kind: 'invalid',
    });
  });
});
