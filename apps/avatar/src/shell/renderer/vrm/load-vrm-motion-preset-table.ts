// Wave 3 chunk 3-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Synchronously loads the VRM motion preset registry table from
// .nimi/spec/avatar/kernel/tables/vrm-motion-presets.yaml. Mirrors the
// chunk 3-A `load-vrm-emote-table.ts` Vite `?raw` + `yaml` parse pattern
// for cross-module consistency.
//
// Topic 2026-05-15-avatar-vrm-deferral-and-authority-reconciliation wave 2
// hard-cuts stale unbacked .vrma rows: only idle_subtle is admitted as a
// built-in interchange asset. Runtime motion support is governed by the
// generated motion provider, not this registry.
//
// Validation here is defense-in-depth (fail-close) for placeholder
// license/source strings — see drift_check in vrm-motion-presets.yaml
// header and packet negative_test #4.

import { parse as parseYaml } from 'yaml';
import motionPresetsYaml from '../../../../../../.nimi/spec/avatar/kernel/tables/vrm-motion-presets.yaml?raw';

export type VrmMotionPresetEntry = {
  /** Stable ontology-anchored id (e.g. 'idle_subtle'). */
  id: string;
  /** `.vrma` filename relative to `builtinDir`. */
  file: string;
  /** Whether the AnimationAction loops by default. */
  loop: boolean;
  /** SPDX id, "internal", or a "MIT (forked from ...)" fork-copy descriptor.
   *  Placeholder tokens (TBD / candidate / VRoid Hub 候选) are rejected. */
  license: string;
  /** URL or "internal" source description. Empty strings are rejected. */
  source: string;
  /** Optional path to THIRD_PARTY_LICENSES.md attribution entry. */
  attribution?: string;
};

export type VrmMotionPresetTable = {
  /** Asset directory relative to repo root, e.g.
   *  'apps/avatar/assets/vrm-motion-presets'. */
  builtinDir: string;
  presets: VrmMotionPresetEntry[];
};

/**
 * Built-in interchange ids that must physically exist in the shipped asset
 * directory. Generated motion route ids are intentionally not listed here.
 */
export const ADMITTED_INTERCHANGE_PRESET_IDS: ReadonlyArray<string> = [
  'idle_subtle',
];

/**
 * Reject list of placeholder values. license / source equality (after
 * trim) against any of these throws at table-load time. The 3 wave_3
 * external entries stay commented in the YAML until they are admitted
 * with concrete values, so this guard catches accidental admission of
 * still-placeholder rows.
 */
const PLACEHOLDER_TOKENS: ReadonlyArray<string> = [
  'TBD',
  'candidate',
  'VRoid Hub 候选',
];

type RawEntry = {
  id?: unknown;
  file?: unknown;
  loop?: unknown;
  license?: unknown;
  source?: unknown;
  attribution?: unknown;
};

type RawTable = {
  builtin_dir?: unknown;
  presets?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectPlaceholder(field: string, id: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" has empty ${field}`,
    );
  }
  for (const token of PLACEHOLDER_TOKENS) {
    if (trimmed === token) {
      throw new Error(
        `load-vrm-motion-preset-table: preset "${id}" has placeholder ${field} "${token}"`,
      );
    }
  }
}

function normalizeEntry(raw: RawEntry, index: number): VrmMotionPresetEntry {
  if (!isObject(raw)) {
    throw new Error(
      `load-vrm-motion-preset-table: preset[${index}] is not an object`,
    );
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      `load-vrm-motion-preset-table: preset[${index}] missing/invalid id`,
    );
  }
  const file = raw.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" missing/invalid file`,
    );
  }
  const loop = raw.loop;
  if (typeof loop !== 'boolean') {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" loop must be boolean (got ${String(loop)})`,
    );
  }
  const license = raw.license;
  if (typeof license !== 'string') {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" missing license`,
    );
  }
  rejectPlaceholder('license', id, license);
  const source = raw.source;
  if (typeof source !== 'string') {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" missing source`,
    );
  }
  rejectPlaceholder('source', id, source);
  const attribution = raw.attribution;
  if (attribution !== undefined && typeof attribution !== 'string') {
    throw new Error(
      `load-vrm-motion-preset-table: preset "${id}" attribution must be string when present`,
    );
  }
  const out: VrmMotionPresetEntry = { id, file, loop, license, source };
  if (typeof attribution === 'string' && attribution.length > 0) {
    out.attribution = attribution;
  }
  return out;
}

export function normalizeVrmMotionPresetTable(raw: unknown): VrmMotionPresetTable {
  if (!isObject(raw)) {
    throw new Error('load-vrm-motion-preset-table: top-level value is not an object');
  }
  const table = raw as RawTable;
  const builtinDir = table.builtin_dir;
  if (typeof builtinDir !== 'string' || builtinDir.trim().length === 0) {
    throw new Error('load-vrm-motion-preset-table: missing/empty builtin_dir');
  }
  const presetsRaw = table.presets;
  if (!Array.isArray(presetsRaw) || presetsRaw.length === 0) {
    throw new Error('load-vrm-motion-preset-table: presets is not a non-empty array');
  }
  const seen = new Set<string>();
  const presets: VrmMotionPresetEntry[] = [];
  presetsRaw.forEach((entry, index) => {
    const normalized = normalizeEntry(entry as RawEntry, index);
    if (seen.has(normalized.id)) {
      throw new Error(
        `load-vrm-motion-preset-table: duplicate preset id "${normalized.id}"`,
      );
    }
    seen.add(normalized.id);
    presets.push(normalized);
  });
  // Interchange invariant: every admitted built-in asset id must remain present.
  for (const required of ADMITTED_INTERCHANGE_PRESET_IDS) {
    if (!seen.has(required)) {
      throw new Error(
        `load-vrm-motion-preset-table: missing admitted interchange preset "${required}"`,
      );
    }
  }
  return { builtinDir, presets };
}

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
