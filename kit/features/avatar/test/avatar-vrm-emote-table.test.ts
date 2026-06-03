import { describe, expect, it } from 'vitest';

import { normalizeVrmEmoteTable } from '../src/vrm.js';

describe('normalizeVrmEmoteTable', () => {
  it('rejects a bundle whose primary weight exceeds the expressive cap', () => {
    expect(() =>
      normalizeVrmEmoteTable({
        emotes: {
          too_much: {
            blend_duration_sec: 0.4,
            expressions: [
              { name: 'happy', weight: 0.95 },
              { name: 'aa', weight: 0.2 },
            ],
          },
        },
      }),
    ).toThrow(/primary weight/);
  });

  it('rejects a bundle with no expressions', () => {
    expect(() =>
      normalizeVrmEmoteTable({
        emotes: {
          empty: {
            blend_duration_sec: 0.4,
            expressions: [],
          },
        },
      }),
    ).toThrow(/no expressions/);
  });

  it('rejects a bundle with non-positive blend_duration_sec', () => {
    expect(() =>
      normalizeVrmEmoteTable({
        emotes: {
          bad_blend: {
            blend_duration_sec: 0,
            expressions: [{ name: 'happy', weight: 0.5 }],
          },
        },
      }),
    ).toThrow(/blend_duration_sec/);
  });

  it('rejects an expression weight outside [0, 1]', () => {
    expect(() =>
      normalizeVrmEmoteTable({
        emotes: {
          bad_weight: {
            blend_duration_sec: 0.4,
            expressions: [{ name: 'happy', weight: 1.5 }],
          },
        },
      }),
    ).toThrow(/weight/);
  });

  it('rejects an expression with empty name', () => {
    expect(() =>
      normalizeVrmEmoteTable({
        emotes: {
          bad_name: {
            blend_duration_sec: 0.4,
            expressions: [{ name: '', weight: 0.5 }],
          },
        },
      }),
    ).toThrow(/invalid name/);
  });

  it('rejects when top-level emotes is missing', () => {
    expect(() => normalizeVrmEmoteTable({})).toThrow(/emotes/);
  });

  it('rejects when emotes map is empty', () => {
    expect(() => normalizeVrmEmoteTable({ emotes: {} })).toThrow(/empty/);
  });

  it('accepts a valid synthesized table', () => {
    const table = normalizeVrmEmoteTable({
      emotes: {
        ok: {
          blend_duration_sec: 0.5,
          expressions: [
            { name: 'happy', weight: 0.7 },
            { name: 'aa', weight: 0.2 },
          ],
        },
      },
    });
    expect(table.emotes.ok?.blendDurationSec).toBe(0.5);
    expect(table.emotes.ok?.expressions).toHaveLength(2);
  });
});
