// Wave 3 chunk 3-B — load-vrm-motion-preset-table tests.
//
// Real YAML round-trip via Vite ?raw → 4 wave_0 entries; placeholder
// rejection on synthesized inputs (license/source TBD/candidate/empty);
// duplicate id rejection; wave_0 admit regression marker.

import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetVrmMotionPresetTableForTests,
  loadVrmMotionPresetTable,
  normalizeVrmMotionPresetTable,
  WAVE_0_ADMITTED_PRESET_IDS,
} from './load-vrm-motion-preset-table.js';

afterEach(() => {
  __resetVrmMotionPresetTableForTests();
});

describe('loadVrmMotionPresetTable', () => {
  it('parses the real spec YAML and returns at least the 4 wave_0 entries', () => {
    const table = loadVrmMotionPresetTable();
    expect(table).toBeDefined();
    expect(table.builtinDir).toBe('apps/avatar/assets/vrm-motion-presets');
    // Wave_0 admit: exactly the 4 anchor ids while the 3 wave_3 entries
    // remain commented out in the YAML. After chunk 3-D flips them in,
    // this assertion relaxes to >= 4.
    const ids = table.presets.map((p) => p.id).sort();
    for (const required of WAVE_0_ADMITTED_PRESET_IDS) {
      expect(ids, `missing wave_0 admitted id "${required}"`).toContain(required);
    }
  });

  it('every parsed entry has non-placeholder license + source', () => {
    const table = loadVrmMotionPresetTable();
    for (const entry of table.presets) {
      expect(entry.license.trim().length).toBeGreaterThan(0);
      expect(entry.source.trim().length).toBeGreaterThan(0);
      expect(entry.license).not.toBe('TBD');
      expect(entry.source).not.toBe('TBD');
      expect(entry.license).not.toBe('candidate');
      expect(entry.source).not.toBe('candidate');
    }
  });

  it('every parsed entry has a non-empty file string and boolean loop', () => {
    const table = loadVrmMotionPresetTable();
    for (const entry of table.presets) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.file).toBe('string');
      expect(entry.file.length).toBeGreaterThan(0);
      expect(typeof entry.loop).toBe('boolean');
    }
  });

  it('idle_subtle is the MIT fork-copy entry with attribution', () => {
    const table = loadVrmMotionPresetTable();
    const idle = table.presets.find((p) => p.id === 'idle_subtle');
    expect(idle).toBeDefined();
    expect(idle?.license).toMatch(/MIT/);
    expect(idle?.attribution).toBe('apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md');
  });

  it('caches the parsed table across calls (same reference)', () => {
    const a = loadVrmMotionPresetTable();
    const b = loadVrmMotionPresetTable();
    expect(a).toBe(b);
  });
});

describe('normalizeVrmMotionPresetTable', () => {
  function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'idle_subtle',
      file: 'idle_subtle.vrma',
      loop: true,
      license: 'internal',
      source: 'internal author target',
      ...overrides,
    };
  }

  function tableWith(extras: Array<Record<string, unknown>> = []): Record<string, unknown> {
    // Always include the 4 wave_0 anchors so the wave_0 admit invariant
    // doesn't trigger on unrelated negative tests.
    const anchors = WAVE_0_ADMITTED_PRESET_IDS.map((id, i) => ({
      id,
      file: `${id}.vrma`,
      loop: i === 0 || i === 1,
      license: 'internal',
      source: 'internal author target',
    }));
    return {
      builtin_dir: 'apps/avatar/assets/vrm-motion-presets',
      presets: [...anchors, ...extras],
    };
  }

  it('rejects missing builtin_dir', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({ presets: [validEntry()] }),
    ).toThrow(/builtin_dir/);
  });

  it('rejects empty builtin_dir', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({ builtin_dir: '   ', presets: [validEntry()] }),
    ).toThrow(/builtin_dir/);
  });

  it('rejects empty presets array', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({ builtin_dir: 'a/b', presets: [] }),
    ).toThrow(/presets/);
  });

  it('rejects an entry missing license', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({
        builtin_dir: 'a/b',
        presets: [
          { id: 'idle_subtle', file: 'a.vrma', loop: true, source: 'x' },
        ],
      }),
    ).toThrow(/license/);
  });

  it('rejects placeholder license "TBD"', () => {
    expect(() =>
      normalizeVrmMotionPresetTable(
        tableWith([
          {
            id: 'greet_wave',
            file: 'greet_wave.vrma',
            loop: false,
            license: 'TBD',
            source: 'https://example.com',
          },
        ]),
      ),
    ).toThrow(/placeholder license/);
  });

  it('rejects placeholder license "candidate"', () => {
    expect(() =>
      normalizeVrmMotionPresetTable(
        tableWith([
          {
            id: 'wave_hello',
            file: 'wave_hello.vrma',
            loop: false,
            license: 'candidate',
            source: 'https://example.com',
          },
        ]),
      ),
    ).toThrow(/placeholder license/);
  });

  it('rejects placeholder source "VRoid Hub 候选"', () => {
    expect(() =>
      normalizeVrmMotionPresetTable(
        tableWith([
          {
            id: 'think_chin_touch',
            file: 'think_chin_touch.vrma',
            loop: false,
            license: 'CC-BY-4.0',
            source: 'VRoid Hub 候选',
          },
        ]),
      ),
    ).toThrow(/placeholder source/);
  });

  it('rejects empty source string', () => {
    expect(() =>
      normalizeVrmMotionPresetTable(
        tableWith([
          {
            id: 'greet_wave',
            file: 'greet_wave.vrma',
            loop: false,
            license: 'internal',
            source: '   ',
          },
        ]),
      ),
    ).toThrow(/empty source/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({
        builtin_dir: 'a/b',
        presets: [
          { id: 'idle_subtle', file: 'a.vrma', loop: true, license: 'internal', source: 'x' },
          { id: 'idle_subtle', file: 'b.vrma', loop: true, license: 'internal', source: 'y' },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it('rejects when a wave_0 admitted id is missing', () => {
    // Build a table with only 3 of the 4 anchors.
    expect(() =>
      normalizeVrmMotionPresetTable({
        builtin_dir: 'a/b',
        presets: [
          { id: 'idle_subtle', file: 'a.vrma', loop: true, license: 'internal', source: 'x' },
          { id: 'listen_lean', file: 'b.vrma', loop: true, license: 'internal', source: 'x' },
          { id: 'nod_yes', file: 'c.vrma', loop: false, license: 'internal', source: 'x' },
        ],
      }),
    ).toThrow(/wave_0 admitted preset/);
  });

  it('rejects non-boolean loop', () => {
    expect(() =>
      normalizeVrmMotionPresetTable({
        builtin_dir: 'a/b',
        presets: [
          {
            id: 'idle_subtle',
            file: 'idle_subtle.vrma',
            loop: 'true',
            license: 'internal',
            source: 'x',
          },
        ],
      }),
    ).toThrow(/loop/);
  });

  it('accepts the 4-anchor table without the 3 deferred wave_3 entries', () => {
    const table = normalizeVrmMotionPresetTable(tableWith());
    expect(table.presets).toHaveLength(4);
  });

  it('accepts an extended 7-entry table (post-wave_3 flip preview)', () => {
    const table = normalizeVrmMotionPresetTable(
      tableWith([
        {
          id: 'greet_wave',
          file: 'greet_wave.vrma',
          loop: false,
          license: 'CC-BY-4.0',
          source: 'https://example.com/greet_wave',
        },
        {
          id: 'wave_hello',
          file: 'wave_hello.vrma',
          loop: false,
          license: 'CC-BY-4.0',
          source: 'https://example.com/wave_hello',
        },
        {
          id: 'think_chin_touch',
          file: 'think_chin_touch.vrma',
          loop: false,
          license: 'CC-BY-4.0',
          source: 'https://example.com/think_chin_touch',
        },
      ]),
    );
    expect(table.presets).toHaveLength(7);
  });
});
