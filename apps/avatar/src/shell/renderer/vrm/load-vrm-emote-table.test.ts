// Wave 3 chunk 3-A — load-vrm-emote-table tests.
//
// Covers: real YAML round-trip via Vite ?raw → all 11 bundles parsed;
// snake_case → camelCase normalization; primary-cap rejection on invalid
// synthesized inputs.

import { describe, it, expect } from 'vitest';
import {
  loadVrmEmoteTable,
  normalizeVrmEmoteTable,
} from './load-vrm-emote-table.js';

const EXPECTED_EMOTES: ReadonlyArray<string> = [
  'neutral',
  'happy',
  'sad',
  'shy',
  'angry',
  'surprised',
  'confused',
  'excited',
  'worried',
  'embarrassed',
  'relaxed',
];

describe('loadVrmEmoteTable', () => {
  it('parses the real spec YAML and returns a valid VrmEmoteTable', () => {
    const table = loadVrmEmoteTable();
    expect(table).toBeDefined();
    expect(table.emotes).toBeDefined();
    for (const name of EXPECTED_EMOTES) {
      expect(table.emotes[name], `missing emote "${name}"`).toBeDefined();
    }
  });

  it('contains exactly the 11 admitted bundles', () => {
    const table = loadVrmEmoteTable();
    const names = Object.keys(table.emotes).sort();
    expect(names.sort()).toEqual([...EXPECTED_EMOTES].sort());
  });

  it('normalizes snake_case blend_duration_sec to camelCase blendDurationSec', () => {
    const table = loadVrmEmoteTable();
    for (const [name, bundle] of Object.entries(table.emotes)) {
      expect(typeof bundle.blendDurationSec, `bundle "${name}" blendDurationSec type`).toBe(
        'number',
      );
      expect(bundle.blendDurationSec).toBeGreaterThan(0);
      expect(bundle.expressions.length).toBeGreaterThanOrEqual(1);
      for (const entry of bundle.expressions) {
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.weight).toBe('number');
        expect(entry.weight).toBeGreaterThanOrEqual(0);
        expect(entry.weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every parsed bundle satisfies the primary <= 0.8 cap (excluding the neutral rest preset)', () => {
    // The `neutral` expression is the VRM rest pose and the canonical
    // neutral bundle authors it at 1.0 (vrm-emote-states.yaml). The
    // primary cap applies only to expressive presets — see exemption
    // in vrm-emote-state.ts (PRIMARY_CAP_EXEMPT_PRESETS).
    const table = loadVrmEmoteTable();
    for (const [name, bundle] of Object.entries(table.emotes)) {
      const primary = bundle.expressions
        .filter((e) => e.name !== 'neutral')
        .reduce((m, e) => Math.max(m, e.weight), 0);
      expect(primary, `emote "${name}" expressive primary weight`).toBeLessThanOrEqual(0.8);
    }
  });

  it('caches the parsed table (same reference on second call)', () => {
    const a = loadVrmEmoteTable();
    const b = loadVrmEmoteTable();
    expect(a).toBe(b);
  });
});

describe('normalizeVrmEmoteTable', () => {
  it('rejects a bundle whose primary weight exceeds the 0.8 cap', () => {
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
