// Wave 3 chunk 3-A of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Synchronously loads the VRM emote recipe table from
// .nimi/spec/avatar/kernel/tables/vrm-emote-states.yaml. Vite's `?raw`
// suffix inlines the file as a string at bundle time; we parse with
// `yaml` at runtime. The state machine itself does no filesystem I/O.
//
// Validation here is a defense-in-depth pass that runs BEFORE the emote
// state machine sees the table, so spec drift surfaces with a clear error
// (vs a less-specific construction failure inside the state machine).

import { parse as parseYaml } from 'yaml';
import emoteTableYaml from '../../../../../../.nimi/spec/avatar/kernel/tables/vrm-emote-states.yaml?raw';
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
    throw new Error(`load-vrm-emote-table: emote "${name}" is not an object`);
  }
  const blendRaw = raw.blend_duration_sec;
  if (typeof blendRaw !== 'number' || !Number.isFinite(blendRaw) || blendRaw <= 0) {
    throw new Error(
      `load-vrm-emote-table: emote "${name}" has invalid blend_duration_sec ${String(blendRaw)}`,
    );
  }
  const expressionsRaw = raw.expressions;
  if (!Array.isArray(expressionsRaw) || expressionsRaw.length === 0) {
    throw new Error(`load-vrm-emote-table: emote "${name}" has no expressions`);
  }
  const expressions: VrmEmoteBundle['expressions'] = [];
  let primary = 0;
  for (const entry of expressionsRaw as RawExpressionEntry[]) {
    if (!isObject(entry)) {
      throw new Error(`load-vrm-emote-table: emote "${name}" has non-object expression entry`);
    }
    const exprName = entry.name;
    const weight = entry.weight;
    if (typeof exprName !== 'string' || exprName.length === 0) {
      throw new Error(
        `load-vrm-emote-table: emote "${name}" has expression with invalid name ${String(exprName)}`,
      );
    }
    if (
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 1
    ) {
      throw new Error(
        `load-vrm-emote-table: emote "${name}" expression "${exprName}" has weight ${String(weight)} (must be in [0, 1])`,
      );
    }
    // The `neutral` rest-pose preset is exempt from the 0.8 expressive cap
    // (the canonical neutral bundle authors it at 1.0). Cap applies to all
    // other expressive presets so the negative test (synthesized 0.95
    // primary on an expressive preset) still fails-close.
    if (exprName !== 'neutral' && weight > primary) primary = weight;
    expressions.push({ name: exprName, weight });
  }
  if (primary > PRIMARY_EXPRESSION_WEIGHT_CAP) {
    throw new Error(
      `load-vrm-emote-table: emote "${name}" primary weight ${primary} exceeds cap ${PRIMARY_EXPRESSION_WEIGHT_CAP}`,
    );
  }
  return { blendDurationSec: blendRaw, expressions };
}

export function normalizeVrmEmoteTable(raw: unknown): VrmEmoteTable {
  if (!isObject(raw)) {
    throw new Error('load-vrm-emote-table: top-level value is not an object');
  }
  const table = raw as RawTable;
  if (!isObject(table.emotes)) {
    throw new Error('load-vrm-emote-table: missing "emotes" map');
  }
  const emotes: Record<string, VrmEmoteBundle> = {};
  for (const [name, bundle] of Object.entries(table.emotes)) {
    emotes[name] = normalizeBundle(name, bundle);
  }
  if (Object.keys(emotes).length === 0) {
    throw new Error('load-vrm-emote-table: "emotes" map is empty');
  }
  return { emotes };
}

let cached: VrmEmoteTable | null = null;

export function loadVrmEmoteTable(): VrmEmoteTable {
  if (cached !== null) return cached;
  const parsed = parseYaml(emoteTableYaml);
  cached = normalizeVrmEmoteTable(parsed);
  return cached;
}
