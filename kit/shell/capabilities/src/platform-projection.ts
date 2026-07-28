import { buildNimiFactoryProfileIndexRecord, type NimiFactoryProfileIndexRecord } from './ai-profile.js';

export type NimiPlatformProjectionId = 'factory-profile-index';

export type NimiPlatformProjectionInput = {
  readonly projectionId: string;
  readonly updatedAt?: string;
};

export type NimiPlatformProjectionResult = {
  readonly projectionId: NimiPlatformProjectionId;
  readonly record: NimiFactoryProfileIndexRecord;
};

export function buildNimiPlatformProjection(input: NimiPlatformProjectionInput): NimiPlatformProjectionResult {
  const projectionId = normalizeNimiCapabilityText(input.projectionId);
  if (projectionId !== 'factory-profile-index') {
    throw new Error(`unsupported platform projection: ${projectionId || '<missing>'}`);
  }
  return {
    projectionId,
    record: buildNimiFactoryProfileIndexRecord(input.updatedAt || new Date().toISOString()),
  };
}

function normalizeNimiCapabilityText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
