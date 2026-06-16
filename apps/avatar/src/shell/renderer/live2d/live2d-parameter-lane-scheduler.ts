import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';

export const LIVE2D_PARAMETER_LANE_ORDER = [
  'motion',
  'expression',
  'physics',
  'pose',
  'breath_blink',
  'look_at_idle',
  'speech_lipsync',
  'live2d_extension_direct',
] as const;

export type Live2DParameterLaneId = typeof LIVE2D_PARAMETER_LANE_ORDER[number];

export type Live2DParameterCommandLanes = {
  speechLipsync: ReadonlyMap<string, number>;
  live2dExtensionDirect: ReadonlyMap<string, number>;
};

export type Live2DParameterLaneFrameStats = {
  laneOrder: readonly Live2DParameterLaneId[];
  appliedLanes: readonly Live2DParameterLaneId[];
  elapsedMs: number;
  laneElapsedMs: Readonly<Record<Live2DParameterLaneId, number>>;
  unsupportedParameterIds: readonly string[];
  speechLipsyncParameterCount: number;
  directParameterCount: number;
};

export type Live2DParameterLaneScheduler = {
  run(input: {
    model: Live2DVisualModelShape;
    lanes: Partial<Record<Live2DParameterLaneId, () => boolean | void>>;
    parameters: Live2DParameterCommandLanes;
  }): Live2DParameterLaneFrameStats;
};

type ParameterIdContainer = {
  getSize?: () => number;
  get?: (index: number) => unknown;
  at?: (index: number) => unknown;
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function boundedMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(Math.min(value, 1000) * 1000) / 1000;
}

function stringIdsFromContainer(container: unknown): string[] | null {
  if (Array.isArray(container)) {
    return container.map((id) => String(id));
  }
  if (!container || typeof container !== 'object') {
    return null;
  }
  const vector = container as ParameterIdContainer;
  if (typeof vector.getSize !== 'function') {
    return null;
  }
  const ids: string[] = [];
  const size = Math.max(0, vector.getSize());
  for (let index = 0; index < size; index += 1) {
    const value =
      typeof vector.at === 'function'
        ? vector.at(index)
        : typeof vector.get === 'function'
          ? vector.get(index)
          : undefined;
    if (value !== undefined && value !== null) {
      ids.push(String(value));
    }
  }
  return ids;
}

function readKnownParameterIds(model: Live2DVisualModelShape): Set<string> | null {
  const directIds = stringIdsFromContainer(model.parameters?.ids);
  if (directIds) {
    return new Set(directIds);
  }
  const internalIds = stringIdsFromContainer((model as unknown as { _parameterIds?: unknown })._parameterIds);
  return internalIds ? new Set(internalIds) : null;
}

function hasParameter(model: Live2DVisualModelShape, knownIds: Set<string> | null, parameterId: string): boolean {
  if (knownIds) {
    return knownIds.has(parameterId);
  }
  if (typeof model.getParameterValueById === 'function') {
    const value = model.getParameterValueById(parameterId);
    return Number.isFinite(value);
  }
  return true;
}

function applyParameterMap(input: {
  model: Live2DVisualModelShape;
  knownIds: Set<string> | null;
  parameters: ReadonlyMap<string, number>;
  unsupportedParameterIds: Set<string>;
  warnUnsupported(parameterId: string): void;
}): boolean {
  let applied = false;
  for (const [parameterId, value] of input.parameters) {
    if (!Number.isFinite(value) || !hasParameter(input.model, input.knownIds, parameterId)) {
      input.unsupportedParameterIds.add(parameterId);
      input.warnUnsupported(parameterId);
      continue;
    }
    input.model.setParameterValueById(parameterId, value, 1);
    applied = true;
  }
  return applied;
}

export function createLive2DParameterLaneScheduler(input: {
  now?: () => number;
  warn?: (message: string) => void;
} = {}): Live2DParameterLaneScheduler {
  const now = input.now ?? nowMs;
  const warn = input.warn ?? ((message: string) => console.warn(message));
  const warnedUnsupported = new Set<string>();

  function warnUnsupported(parameterId: string): void {
    if (warnedUnsupported.has(parameterId)) {
      return;
    }
    warnedUnsupported.add(parameterId);
    warn(`[avatar:live2d:parameter-lane] unsupported parameter id ignored: ${parameterId}`);
  }

  return {
    run({ model, lanes, parameters }) {
      const frameStart = now();
      const knownIds = readKnownParameterIds(model);
      const unsupportedParameterIds = new Set<string>();
      const appliedLanes: Live2DParameterLaneId[] = [];
      const laneElapsedMs = Object.fromEntries(
        LIVE2D_PARAMETER_LANE_ORDER.map((lane) => [lane, 0]),
      ) as Record<Live2DParameterLaneId, number>;

      for (const lane of LIVE2D_PARAMETER_LANE_ORDER) {
        const laneStart = now();
        let applied = false;
        if (lane === 'speech_lipsync') {
          applied = applyParameterMap({
            model,
            knownIds,
            parameters: parameters.speechLipsync,
            unsupportedParameterIds,
            warnUnsupported,
          });
        } else if (lane === 'live2d_extension_direct') {
          applied = applyParameterMap({
            model,
            knownIds,
            parameters: parameters.live2dExtensionDirect,
            unsupportedParameterIds,
            warnUnsupported,
          });
        } else {
          const runLane = lanes[lane];
          applied = runLane ? runLane() === true : false;
        }
        laneElapsedMs[lane] = boundedMs(now() - laneStart);
        if (applied) {
          appliedLanes.push(lane);
        }
      }

      return {
        laneOrder: LIVE2D_PARAMETER_LANE_ORDER,
        appliedLanes,
        elapsedMs: boundedMs(now() - frameStart),
        laneElapsedMs,
        unsupportedParameterIds: [...unsupportedParameterIds].sort(),
        speechLipsyncParameterCount: parameters.speechLipsync.size,
        directParameterCount: parameters.live2dExtensionDirect.size,
      };
    },
  };
}
