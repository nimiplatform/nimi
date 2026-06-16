import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';

export type Live2DExpressionBlendMode = 'add' | 'multiply' | 'overwrite';

export type Live2DExpressionParameter = {
  id: string;
  value: number;
  blend: Live2DExpressionBlendMode;
};

export type Live2DExpressionInventoryEntry = {
  expressionId: string;
  sourcePath: string;
  parameters: readonly Live2DExpressionParameter[];
};

export type Live2DExpressionInventory = {
  entries: ReadonlyMap<string, Live2DExpressionInventoryEntry>;
  expressionIds: readonly string[];
  parameterIds: readonly string[];
  parameterCount: number;
  blendModeCounts: Readonly<Record<Live2DExpressionBlendMode, number>>;
};

export type Live2DExpressionInventorySummary = {
  expressionInventoryRef: string | null;
  expressionCount: number;
  expressionIds: readonly string[];
  expressionParameterCount: number;
  expressionParameterIds: readonly string[];
  expressionBlendModeCounts: Readonly<Record<Live2DExpressionBlendMode, number>>;
  expressionStackSupported: boolean;
};

export type Live2DExpressionOverlayFrame = {
  activeExpressionId: string | null;
  frameApplied: boolean;
  parameterIds: readonly string[];
  resetParameterIds: readonly string[];
};

type RawExpressionParameter = {
  Id?: unknown;
  Value?: unknown;
  Blend?: unknown;
};

type ParameterAccessModel = Live2DVisualModelShape & {
  getParameterValueById?: (parameterId: unknown) => number;
  getParameterDefaultValueById?: (parameterId: unknown) => number;
  addParameterValueById?: (parameterId: unknown, value: number, weight?: number) => void;
  multiplyParameterValueById?: (parameterId: unknown, value: number, weight?: number) => void;
  parameters?: {
    ids?: readonly unknown[];
    values?: ArrayLike<number>;
    defaultValues?: ArrayLike<number>;
  };
};

const EMPTY_BLEND_COUNTS: Readonly<Record<Live2DExpressionBlendMode, number>> = Object.freeze({
  add: 0,
  multiply: 0,
  overwrite: 0,
});

function safeRefSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 96) || 'live2d';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Live2D expression ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`Live2D expression ${label} must be a non-empty string`);
  }
  return normalized;
}

function requiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Live2D expression ${label} must be a finite number`);
  }
  return value;
}

function normalizeBlendMode(value: unknown): Live2DExpressionBlendMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'add';
  switch (normalized) {
    case '':
    case 'add':
      return 'add';
    case 'multiply':
      return 'multiply';
    case 'overwrite':
      return 'overwrite';
    default:
      throw new Error(`Live2D expression blend mode is not admitted: ${String(value)}`);
  }
}

function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes);
}

export function parseLive2DExpressionInventoryEntry(input: {
  expressionId: string;
  sourcePath: string;
  bytes: ArrayBuffer;
}): Live2DExpressionInventoryEntry {
  const expressionId = requiredString(input.expressionId, 'id');
  const sourcePath = requiredString(input.sourcePath, 'source path');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(input.bytes));
  } catch (error) {
    throw new Error(`invalid Live2D expression json (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = readObject(parsed, `${expressionId}`);
  if (!Array.isArray(raw.Parameters)) {
    throw new Error(`Live2D expression ${expressionId} missing Parameters array`);
  }
  const parameters = raw.Parameters.map((item, index): Live2DExpressionParameter => {
    const parameter = readObject(item, `${expressionId}.Parameters[${index}]`) as RawExpressionParameter;
    return {
      id: requiredString(parameter.Id, `${expressionId}.Parameters[${index}].Id`),
      value: requiredFiniteNumber(parameter.Value, `${expressionId}.Parameters[${index}].Value`),
      blend: normalizeBlendMode(parameter.Blend),
    };
  });
  return { expressionId, sourcePath, parameters };
}

export function createLive2DExpressionInventory(
  entries: Iterable<Live2DExpressionInventoryEntry>,
): Live2DExpressionInventory {
  const byId = new Map<string, Live2DExpressionInventoryEntry>();
  const parameterIds = new Set<string>();
  const blendModeCounts: Record<Live2DExpressionBlendMode, number> = {
    add: 0,
    multiply: 0,
    overwrite: 0,
  };
  let parameterCount = 0;
  for (const entry of entries) {
    const expressionId = requiredString(entry.expressionId, 'inventory expression id');
    if (byId.has(expressionId)) {
      throw new Error(`Live2D expression inventory contains duplicate id: ${expressionId}`);
    }
    for (const parameter of entry.parameters) {
      parameterIds.add(parameter.id);
      blendModeCounts[parameter.blend] += 1;
      parameterCount += 1;
    }
    byId.set(expressionId, {
      expressionId,
      sourcePath: entry.sourcePath,
      parameters: [...entry.parameters],
    });
  }
  return {
    entries: byId,
    expressionIds: [...byId.keys()].sort(),
    parameterIds: [...parameterIds].sort(),
    parameterCount,
    blendModeCounts,
  };
}

export function createEmptyLive2DExpressionInventory(): Live2DExpressionInventory {
  return createLive2DExpressionInventory([]);
}

export function parseLive2DExpressionInventory(input: {
  expressions: ReadonlyMap<string, string>;
  expressionBytes: ReadonlyMap<string, ArrayBuffer>;
}): Live2DExpressionInventory {
  const entries: Live2DExpressionInventoryEntry[] = [];
  for (const [expressionId, sourcePath] of input.expressions) {
    const bytes = input.expressionBytes.get(expressionId);
    if (!bytes) {
      throw new Error(`Live2D expression bytes missing for ${expressionId}`);
    }
    entries.push(parseLive2DExpressionInventoryEntry({ expressionId, sourcePath, bytes }));
  }
  return createLive2DExpressionInventory(entries);
}

export function summarizeLive2DExpressionInventory(input: {
  modelId: string;
  inventory: Live2DExpressionInventory;
}): Live2DExpressionInventorySummary {
  const digest = JSON.stringify({
    expressions: input.inventory.expressionIds.map((expressionId) => {
      const entry = input.inventory.entries.get(expressionId);
      return {
        id: expressionId,
        parameters: entry?.parameters.map((parameter) => [
          parameter.id,
          parameter.value,
          parameter.blend,
        ]) ?? [],
      };
    }),
  });
  return {
    expressionInventoryRef: input.inventory.expressionIds.length > 0
      ? `avatar.live2d.expression-inventory:${safeRefSegment(input.modelId)}:${stableHash(digest)}`
      : null,
    expressionCount: input.inventory.expressionIds.length,
    expressionIds: input.inventory.expressionIds,
    expressionParameterCount: input.inventory.parameterCount,
    expressionParameterIds: input.inventory.parameterIds,
    expressionBlendModeCounts: input.inventory.blendModeCounts,
    expressionStackSupported: input.inventory.expressionIds.length > 0 && input.inventory.parameterCount > 0,
  };
}

function findParameterIndex(model: ParameterAccessModel, parameterId: string): number {
  const ids = model.parameters?.ids;
  if (!ids) return -1;
  return ids.findIndex((id) => String(id) === parameterId);
}

function readCurrentParameterValue(model: ParameterAccessModel, parameterId: string): number {
  if (typeof model.getParameterValueById === 'function') {
    const value = model.getParameterValueById(parameterId);
    if (Number.isFinite(value)) return value;
  }
  const index = findParameterIndex(model, parameterId);
  const value = index >= 0 ? model.parameters?.values?.[index] : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Live2D expression parameter current value unavailable: ${parameterId}`);
}

function readDefaultParameterValue(model: ParameterAccessModel, parameterId: string): number {
  if (typeof model.getParameterDefaultValueById === 'function') {
    const value = model.getParameterDefaultValueById(parameterId);
    if (Number.isFinite(value)) return value;
  }
  const index = findParameterIndex(model, parameterId);
  const value = index >= 0 ? model.parameters?.defaultValues?.[index] : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Live2D expression parameter default value unavailable: ${parameterId}`);
}

function resetParameter(model: ParameterAccessModel, parameterId: string): void {
  model.setParameterValueById(parameterId, readDefaultParameterValue(model, parameterId), 1);
}

function applyParameter(model: ParameterAccessModel, parameter: Live2DExpressionParameter): void {
  switch (parameter.blend) {
    case 'add':
      if (typeof model.addParameterValueById === 'function') {
        model.addParameterValueById(parameter.id, parameter.value, 1);
      } else {
        model.setParameterValueById(parameter.id, readCurrentParameterValue(model, parameter.id) + parameter.value, 1);
      }
      return;
    case 'multiply':
      if (typeof model.multiplyParameterValueById === 'function') {
        model.multiplyParameterValueById(parameter.id, parameter.value, 1);
      } else {
        model.setParameterValueById(parameter.id, readCurrentParameterValue(model, parameter.id) * parameter.value, 1);
      }
      return;
    case 'overwrite':
      model.setParameterValueById(parameter.id, parameter.value, 1);
      return;
  }
}

export function createLive2DExpressionOverlay(
  inventory: Live2DExpressionInventory,
) {
  let activeExpressionId: string | null = null;
  let touchedParameterIds = new Set<string>();

  function resetTouched(model: ParameterAccessModel): string[] {
    const resetIds = [...touchedParameterIds].sort();
    for (const parameterId of resetIds) {
      resetParameter(model, parameterId);
    }
    touchedParameterIds = new Set();
    activeExpressionId = null;
    return resetIds;
  }

  return {
    apply(model: Live2DVisualModelShape, requestedExpressionId: string | null): Live2DExpressionOverlayFrame {
      const target = requestedExpressionId?.trim() || null;
      const accessModel = model as ParameterAccessModel;
      const resetParameterIds =
        activeExpressionId && activeExpressionId !== target ? resetTouched(accessModel) : [];
      if (!target) {
        return {
          activeExpressionId: null,
          frameApplied: resetParameterIds.length > 0,
          parameterIds: [],
          resetParameterIds,
        };
      }
      const entry = inventory.entries.get(target);
      if (!entry) {
        throw new Error(`Live2D expression inventory missing expression: ${target}`);
      }
      activeExpressionId = target;
      touchedParameterIds = new Set(entry.parameters.map((parameter) => parameter.id));
      for (const parameter of entry.parameters) {
        applyParameter(accessModel, parameter);
      }
      return {
        activeExpressionId: target,
        frameApplied: entry.parameters.length > 0 || resetParameterIds.length > 0,
        parameterIds: entry.parameters.map((parameter) => parameter.id),
        resetParameterIds,
      };
    },
    reset(model: Live2DVisualModelShape): Live2DExpressionOverlayFrame {
      const resetParameterIds = resetTouched(model as ParameterAccessModel);
      return {
        activeExpressionId: null,
        frameApplied: resetParameterIds.length > 0,
        parameterIds: [],
        resetParameterIds,
      };
    },
  };
}
