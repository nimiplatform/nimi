import {
  ExecutionInterruptionCause, ExecutionResubmitDisposition, VisionLocateGeometry,
  type ExecutionInterruption, type VisionLocateResult,
} from '../../core-generated/runtime-typed-client.js';
import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppExecutionInterruption = {
  readonly cause: 'runtime-restart';
  readonly resubmitDisposition: 'caller-may-resubmit';
};

export type NimiLocalAppVisionLocation = { readonly label?: string } & (
  | { readonly type: 'box'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly type: 'point'; readonly x: number; readonly y: number }
);

export type NimiLocalAppVisionLocateResult = {
  readonly imageArtifactId: string;
  readonly width: number;
  readonly height: number;
  readonly locations: readonly NimiLocalAppVisionLocation[];
};

export function projectLocalExecutionInterruption(value: unknown, reasonCode: unknown, status: unknown): NimiLocalAppExecutionInterruption | undefined {
  const present = value !== undefined;
  if (present !== (reasonCode === 'ai-execution-interrupted') || (present && status !== 'failed')) localAppProjectionError('Job interruption does not match failure');
  if (!present) return undefined;
  assertExactProjectionKeys(value, ['cause', 'resubmitDisposition'], 'Job interruption');
  if (value.cause !== 'runtime-restart' || value.resubmitDisposition !== 'caller-may-resubmit') localAppProjectionError('Job interruption');
  return Object.freeze({ cause: 'runtime-restart', resubmitDisposition: 'caller-may-resubmit' });
}

export function localInterruptionFromRuntime(value: ExecutionInterruption | undefined): NimiLocalAppExecutionInterruption | undefined {
  if (!value) return undefined;
  if (value.cause !== ExecutionInterruptionCause.RUNTIME_RESTART || value.resubmitDisposition !== ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT) localAppProjectionError('Runtime Job interruption');
  return { cause: 'runtime-restart', resubmitDisposition: 'caller-may-resubmit' };
}

export function runtimeInterruptionFromLocal(value: NimiLocalAppExecutionInterruption | undefined): ExecutionInterruption | undefined {
  return value ? { cause: ExecutionInterruptionCause.RUNTIME_RESTART, resubmitDisposition: ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT } : undefined;
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export function projectVisionLocateResult(value: unknown): NimiLocalAppVisionLocateResult {
  assertExactProjectionKeys(value, ['imageArtifactId', 'width', 'height', 'locations'], 'Locate result');
  if (typeof value.imageArtifactId !== 'string' || !value.imageArtifactId || value.imageArtifactId.trim() !== value.imageArtifactId || value.imageArtifactId.length > 128 ||
      !Number.isSafeInteger(value.width) || (value.width as number) <= 0 || !Number.isSafeInteger(value.height) || (value.height as number) <= 0 || !Array.isArray(value.locations)) localAppProjectionError('Locate image identity');
  const locations = value.locations.map((entry): NimiLocalAppVisionLocation => {
    const location = asRecord(entry);
    const label = location && Object.hasOwn(location, 'label') ? ['label'] : [];
    const coordinates = location?.type === 'box' ? ['x1', 'y1', 'x2', 'y2'] : location?.type === 'point' ? ['x', 'y'] : localAppProjectionError('Locate geometry');
    assertExactProjectionKeys(location, ['type', ...coordinates, ...label], 'Locate location');
    if (label.length && typeof location.label !== 'string') localAppProjectionError('Locate label');
    for (const key of coordinates) {
      const number = location[key];
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) localAppProjectionError('Locate coordinate');
    }
    if (location.type === 'box' && !((location.x1 as number) < (location.x2 as number) && (location.y1 as number) < (location.y2 as number))) localAppProjectionError('Locate box ordering');
    return Object.freeze({ ...location }) as NimiLocalAppVisionLocation;
  });
  return Object.freeze({ imageArtifactId: value.imageArtifactId, width: value.width as number, height: value.height as number, locations: Object.freeze(locations) });
}

export function localVisionLocateFromRuntime(result: VisionLocateResult): NimiLocalAppVisionLocateResult {
  return projectVisionLocateResult({
    imageArtifactId: result.imageArtifactId, width: result.width, height: result.height,
    locations: result.locations.map((location) => {
      const geometry = location.geometry;
      if (geometry.oneofKind !== 'box' && geometry.oneofKind !== 'point') localAppProjectionError('Runtime Locate geometry');
      return { type: geometry.oneofKind, ...(geometry.oneofKind === 'box' ? geometry.box : geometry.point), ...(location.label === undefined ? {} : { label: location.label }) };
    }),
  });
}

export function runtimeVisionLocateFromLocal(result: NimiLocalAppVisionLocateResult): VisionLocateResult {
  return {
    imageArtifactId: result.imageArtifactId, width: result.width, height: result.height,
    locations: result.locations.map((location) => ({
      ...(location.label === undefined ? {} : { label: location.label }),
      geometry: location.type === 'box'
        ? { oneofKind: 'box', box: { x1: location.x1, y1: location.y1, x2: location.x2, y2: location.y2 } }
        : { oneofKind: 'point', point: { x: location.x, y: location.y } },
    })),
  };
}

export function localLocateGeometry(value: VisionLocateGeometry): 'box' | 'point' {
  if (value === VisionLocateGeometry.BOX) return 'box';
  if (value === VisionLocateGeometry.POINT) return 'point';
  return localAppProjectionError('Locate geometry');
}
