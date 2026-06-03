import {
  PRIMARY_EXPRESSION_WEIGHT_CAP,
  type VrmEmoteBundle,
  type VrmEmoteTable,
} from './vrm-emote-state.js';

type RawExpressionEntry = {
  name?: unknown;
  weight?: unknown;
};

type RawBundle = {
  blend_duration_sec?: unknown;
  expressions?: unknown;
};

type RawTable = {
  emotes?: Record<string, RawBundle>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBundle(name: string, raw: RawBundle): VrmEmoteBundle {
  if (!isObject(raw)) {
    throw new Error(`normalize-vrm-emote-table: emote "${name}" is not an object`);
  }
  const blendRaw = raw.blend_duration_sec;
  if (typeof blendRaw !== 'number' || !Number.isFinite(blendRaw) || blendRaw <= 0) {
    throw new Error(
      `normalize-vrm-emote-table: emote "${name}" has invalid blend_duration_sec ${String(blendRaw)}`,
    );
  }
  const expressionsRaw = raw.expressions;
  if (!Array.isArray(expressionsRaw) || expressionsRaw.length === 0) {
    throw new Error(`normalize-vrm-emote-table: emote "${name}" has no expressions`);
  }
  const expressions: VrmEmoteBundle['expressions'] = [];
  let primary = 0;
  for (const entry of expressionsRaw as RawExpressionEntry[]) {
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
    if (
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 1
    ) {
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
  const table = raw as RawTable;
  if (!isObject(table.emotes)) {
    throw new Error('normalize-vrm-emote-table: missing "emotes" map');
  }
  const emotes: Record<string, VrmEmoteBundle> = {};
  for (const [name, bundle] of Object.entries(table.emotes)) {
    emotes[name] = normalizeBundle(name, bundle);
  }
  if (Object.keys(emotes).length === 0) {
    throw new Error('normalize-vrm-emote-table: "emotes" map is empty');
  }
  return { emotes };
}
