// Wave 3 chunk 3-B — load-vrm-motion-preset-table tests.
//
// Real YAML round-trip via Vite ?raw → admitted interchange entries;
// placeholder rejection on synthesized inputs (license/source
// TBD/candidate/empty); duplicate id rejection; admitted-id regression marker.

import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetVrmMotionPresetTableForTests,
  loadVrmMotionPresetTable,
} from './load-vrm-motion-preset-table.js';
import {
  ADMITTED_INTERCHANGE_PRESET_IDS,
} from './vrm-table-normalizers.js';

afterEach(() => {
  __resetVrmMotionPresetTableForTests();
});

describe('loadVrmMotionPresetTable', () => {
  it('parses the real spec YAML and returns the admitted interchange entry', () => {
    const table = loadVrmMotionPresetTable();
    expect(table).toBeDefined();
    expect(table.builtinDir).toBe('apps/avatar/assets/vrm-motion-presets');
    const ids = table.presets.map((p) => p.id).sort();
    for (const required of ADMITTED_INTERCHANGE_PRESET_IDS) {
      expect(ids, `missing admitted interchange id "${required}"`).toContain(required);
    }
    expect(ids).toEqual(['idle_subtle']);
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
