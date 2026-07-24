// Vite-bound loader for the canonical VRM motion preset table. Schema
// normalization lives in Kit; avatar only owns bundling the spec raw YAML.

import { parse as parseYaml } from 'yaml';
import motionPresetsYaml from '../../../../../../config/avatar-vrm-motion-presets.yaml?raw';
import {
  normalizeVrmMotionPresetTable,
  type VrmMotionPresetTable,
} from './vrm-table-normalizers.js';

let cached: VrmMotionPresetTable | null = null;

export function loadVrmMotionPresetTable(): VrmMotionPresetTable {
  if (cached !== null) return cached;
  const parsed = parseYaml(motionPresetsYaml);
  cached = normalizeVrmMotionPresetTable(parsed);
  return cached;
}

/** Test seam: drop the cached table so subsequent loads re-parse + re-validate. */
export function __resetVrmMotionPresetTableForTests(): void {
  cached = null;
}
