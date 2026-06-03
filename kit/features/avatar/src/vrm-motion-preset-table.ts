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

export const ADMITTED_INTERCHANGE_PRESET_IDS: ReadonlyArray<string> = [
  'idle_subtle',
];

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
      `normalize-vrm-motion-preset-table: preset "${id}" has empty ${field}`,
    );
  }
  for (const token of PLACEHOLDER_TOKENS) {
    if (trimmed === token) {
      throw new Error(
        `normalize-vrm-motion-preset-table: preset "${id}" has placeholder ${field} "${token}"`,
      );
    }
  }
}

function normalizeEntry(raw: RawEntry, index: number): VrmMotionPresetEntry {
  if (!isObject(raw)) {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset[${index}] is not an object`,
    );
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset[${index}] missing/invalid id`,
    );
  }
  const file = raw.file;
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" missing/invalid file`,
    );
  }
  const loop = raw.loop;
  if (typeof loop !== 'boolean') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" loop must be boolean (got ${String(loop)})`,
    );
  }
  const license = raw.license;
  if (typeof license !== 'string') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" missing license`,
    );
  }
  rejectPlaceholder('license', id, license);
  const source = raw.source;
  if (typeof source !== 'string') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" missing source`,
    );
  }
  rejectPlaceholder('source', id, source);
  const attribution = raw.attribution;
  if (attribution !== undefined && typeof attribution !== 'string') {
    throw new Error(
      `normalize-vrm-motion-preset-table: preset "${id}" attribution must be string when present`,
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
    throw new Error('normalize-vrm-motion-preset-table: top-level value is not an object');
  }
  const table = raw as RawTable;
  const builtinDir = table.builtin_dir;
  if (typeof builtinDir !== 'string' || builtinDir.trim().length === 0) {
    throw new Error('normalize-vrm-motion-preset-table: missing/empty builtin_dir');
  }
  const presetsRaw = table.presets;
  if (!Array.isArray(presetsRaw) || presetsRaw.length === 0) {
    throw new Error('normalize-vrm-motion-preset-table: presets is not a non-empty array');
  }
  const seen = new Set<string>();
  const presets: VrmMotionPresetEntry[] = [];
  presetsRaw.forEach((entry, index) => {
    const normalized = normalizeEntry(entry as RawEntry, index);
    if (seen.has(normalized.id)) {
      throw new Error(
        `normalize-vrm-motion-preset-table: duplicate preset id "${normalized.id}"`,
      );
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
