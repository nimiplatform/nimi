import {
  createElectronRuntimeEndpointUnavailableError,
  isRuntimeEndpointUnavailableLike,
  runtimeTrustedMetadataInvalidationReason,
} from './errors.js';
import type {
  ElectronRuntimeBridgeTrustedMetadata,
  ElectronRuntimeBridgeTrustedMetadataProvider,
  NimiElectronIpcMainInvokeEvent,
} from './types.js';

export type ElectronTrustedRuntimeMetadataResolutionInput = {
  readonly provider: ElectronRuntimeBridgeTrustedMetadataProvider | undefined;
  readonly command: string;
  readonly methodId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
};

export type ElectronTrustedRuntimeMetadataResolution = {
  readonly trusted: ElectronRuntimeBridgeTrustedMetadata | undefined;
  readonly invalidationConsumed: boolean;
};

export function trustedRuntimeMetadataInvalidationReason(
  provider: ElectronRuntimeBridgeTrustedMetadataProvider | undefined,
  error: unknown,
): string | null {
  return typeof provider?.invalidate === 'function'
    ? runtimeTrustedMetadataInvalidationReason(error)
    : null;
}

export async function resolveTrustedRuntimeMetadata(
  input: ElectronTrustedRuntimeMetadataResolutionInput,
): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> {
  try {
    return await input.provider?.({
      command: input.command,
      methodId: input.methodId,
      event: input.event,
      appId: input.appId,
      runtimeEndpoint: input.runtimeEndpoint,
    });
  } catch (error) {
    if (isRuntimeEndpointUnavailableLike(error)) {
      throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
    }
    throw error;
  }
}

export async function resolveTrustedRuntimeMetadataWithSingleInvalidation(
  input: ElectronTrustedRuntimeMetadataResolutionInput,
): Promise<ElectronTrustedRuntimeMetadataResolution> {
  try {
    return {
      trusted: await resolveTrustedRuntimeMetadata(input),
      invalidationConsumed: false,
    };
  } catch (error) {
    const invalidationReason = trustedRuntimeMetadataInvalidationReason(input.provider, error);
    if (!invalidationReason) {
      throw error;
    }
    input.provider?.invalidate?.(invalidationReason);
    return {
      trusted: await resolveTrustedRuntimeMetadata(input),
      invalidationConsumed: true,
    };
  }
}
