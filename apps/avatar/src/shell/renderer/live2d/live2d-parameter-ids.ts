import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';

type ParameterIdContainer = {
  getSize?: () => number;
  get?: (index: number) => unknown;
  at?: (index: number) => unknown;
};

type CubismIdLike = {
  getString?: () => unknown;
};

function parameterIdText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const cubismId = value as CubismIdLike;
  if (typeof cubismId.getString !== 'function') {
    return null;
  }
  const id = cubismId.getString();
  return typeof id === 'string' && id ? id : null;
}

function valuesFromContainer(container: unknown): unknown[] | null {
  if (Array.isArray(container)) {
    return container;
  }
  if (!container || typeof container !== 'object') {
    return null;
  }
  const vector = container as ParameterIdContainer;
  if (typeof vector.getSize !== 'function') {
    return null;
  }
  const values: unknown[] = [];
  const size = Math.max(0, vector.getSize());
  for (let index = 0; index < size; index += 1) {
    values.push(
      typeof vector.at === 'function'
        ? vector.at(index)
        : typeof vector.get === 'function'
          ? vector.get(index)
          : undefined,
    );
  }
  return values;
}

export function readLive2DKnownParameterIds(
  model: Live2DVisualModelShape,
): Set<string> | null {
  const containers = [
    model.parameters?.ids,
    (model as unknown as { _parameterIds?: unknown })._parameterIds,
  ];
  const ids = new Set<string>();
  let observedContainer = false;
  for (const container of containers) {
    const values = valuesFromContainer(container);
    if (values === null) continue;
    observedContainer = true;
    for (const value of values) {
      const id = parameterIdText(value);
      if (id) ids.add(id);
    }
  }
  return observedContainer ? ids : null;
}
