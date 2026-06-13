import {
  PRIMARY_EXPRESSION_WEIGHT_CAP,
  type VrmEmoteBundle,
  type VrmEmoteTable,
} from './vrm-emote-state.js';

export type { VrmEmoteTable };

export type VrmMotionPresetEntry = {
  id: string;
  file: string;
  loop: boolean;
  license: string;
  source: string;
  attribution?: string;
};

export type VrmMotionPresetTable = {
  builtinDir: string;
  presets: VrmMotionPresetEntry[];
};

export const ADMITTED_INTERCHANGE_PRESET_IDS: ReadonlyArray<string> = ['idle_subtle'];
const PLACEHOLDER_TOKENS: ReadonlyArray<string> = ['TBD', 'candidate', 'VRoid Hub 候选'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectPlaceholder(field: string, id: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`normalize-vrm-motion-preset-table: preset "${id}" has empty ${field}`);
  }
  for (const token of PLACEHOLDER_TOKENS) {
    if (trimmed === token) {
      throw new Error(
        `normalize-vrm-motion-preset-table: preset "${id}" has placeholder ${field} "${token}"`,
      );
    }
  }
}

function normalizeMotionPresetEntry(raw: unknown, index: number): VrmMotionPresetEntry {
  if (!isObject(raw)) {
    throw new Error(`normalize-vrm-motion-preset-table: preset[${index}] is not an object`);
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`normalize-vrm-motion-preset-table: preset[${index}] missing/invalid id`);
  }
  const file = raw.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(`normalize-vrm-motion-preset-table: preset "${id}" missing/invalid file`);
  }
  if (typeof raw.loop !== 'boolean') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" loop must be boolean (got ${String(raw.loop)})`,
    );
  }
  if (typeof raw.license !== 'string') {
    throw new Error(`normalize-vrm-motion-preset-table: preset "${id}" missing license`);
  }
  rejectPlaceholder('license', id, raw.license);
  if (typeof raw.source !== 'string') {
    throw new Error(`normalize-vrm-motion-preset-table: preset "${id}" missing source`);
  }
  rejectPlaceholder('source', id, raw.source);
  if (raw.attribution !== undefined && typeof raw.attribution !== 'string') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" attribution must be string when present`,
    );
  }
  const out: VrmMotionPresetEntry = {
    id,
    file,
    loop: raw.loop,
    license: raw.license,
    source: raw.source,
  };
  if (typeof raw.attribution === 'string' && raw.attribution.length > 0) {
    out.attribution = raw.attribution;
  }
  return out;
}

export function normalizeVrmMotionPresetTable(raw: unknown): VrmMotionPresetTable {
  if (!isObject(raw)) {
    throw new Error('normalize-vrm-motion-preset-table: top-level value is not an object');
  }
  const builtinDir = raw.builtin_dir;
  if (typeof builtinDir !== 'string' || builtinDir.trim().length === 0) {
    throw new Error('normalize-vrm-motion-preset-table: missing/empty builtin_dir');
  }
  const presetsRaw = raw.presets;
  if (!Array.isArray(presetsRaw) || presetsRaw.length === 0) {
    throw new Error('normalize-vrm-motion-preset-table: presets is not a non-empty array');
  }
  const seen = new Set<string>();
  const presets: VrmMotionPresetEntry[] = [];
  presetsRaw.forEach((entry, index) => {
    const normalized = normalizeMotionPresetEntry(entry, index);
    if (seen.has(normalized.id)) {
      throw new Error(`normalize-vrm-motion-preset-table: duplicate preset id "${normalized.id}"`);
    }
    seen.add(normalized.id);
    presets.push(normalized);
  });
  for (const required of ADMITTED_INTERCHANGE_PRESET_IDS) {
    if (!seen.has(required)) {
      throw new Error(
        `normalize-vrm-motion-preset-table: missing admitted interchange preset "${required}"`,
      );
    }
  }
  return { builtinDir, presets };
}

function normalizeEmoteBundle(name: string, raw: unknown): VrmEmoteBundle {
  if (!isObject(raw)) {
    throw new Error(`normalize-vrm-emote-table: emote "${name}" is not an object`);
  }
  const blendRaw = raw.blend_duration_sec;
  if (typeof blendRaw !== 'number' || !Number.isFinite(blendRaw) || blendRaw <= 0) {
    throw new Error(
      `normalize-vrm-emote-table: emote "${name}" has invalid blend_duration_sec ${String(blendRaw)}`,
    );
  }
  if (!Array.isArray(raw.expressions) || raw.expressions.length === 0) {
    throw new Error(`normalize-vrm-emote-table: emote "${name}" has no expressions`);
  }
  const expressions: VrmEmoteBundle['expressions'] = [];
  let primary = 0;
  for (const entry of raw.expressions) {
    if (!isObject(entry)) {
      throw new Error(`normalize-vrm-emote-table: emote "${name}" has non-object expression entry`);
    }
    const exprName = entry.name;
    const weight = entry.weight;
    if (typeof exprName !== 'string' || exprName.length === 0) {
      throw new Error(
        `normalize-vrm-emote-table: emote "${name}" has expression with invalid name ${String(exprName)}`,
      );
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(
        `normalize-vrm-emote-table: emote "${name}" expression "${exprName}" has weight ${String(weight)} (must be in [0, 1])`,
      );
    }
    if (exprName !== 'neutral' && weight > primary) primary = weight;
    expressions.push({ name: exprName, weight });
  }
  if (primary > PRIMARY_EXPRESSION_WEIGHT_CAP) {
    throw new Error(
      `normalize-vrm-emote-table: emote "${name}" primary weight ${primary} exceeds cap ${PRIMARY_EXPRESSION_WEIGHT_CAP}`,
    );
  }
  return { blendDurationSec: blendRaw, expressions };
}

export function normalizeVrmEmoteTable(raw: unknown): VrmEmoteTable {
  if (!isObject(raw)) {
    throw new Error('normalize-vrm-emote-table: top-level value is not an object');
  }
  if (!isObject(raw.emotes)) {
    throw new Error('normalize-vrm-emote-table: missing "emotes" map');
  }
  const emotes: Record<string, VrmEmoteBundle> = {};
  for (const [name, bundle] of Object.entries(raw.emotes)) {
    emotes[name] = normalizeEmoteBundle(name, bundle);
  }
  if (Object.keys(emotes).length === 0) {
    throw new Error('normalize-vrm-emote-table: "emotes" map is empty');
  }
  return { emotes };
}
