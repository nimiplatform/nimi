import type { PlatformClient } from '../platform-client.js';
import type {
  WorldRuntimeProjectionRequest,
  WorldRuntimeProjectionResult,
} from './types.js';

function toRuntimeProjectionRequest(
  input: WorldRuntimeProjectionRequest,
): WorldRuntimeProjectionRequest {
  return {
    worldId: input.worldId,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.releaseAnchor !== undefined ? { releaseAnchor: input.releaseAnchor } : {}),
    ...(input.contextEnvelope !== undefined ? { contextEnvelope: input.contextEnvelope } : {}),
  };
}

function toWorldRuntimeProjectionResult(
  value: WorldRuntimeProjectionResult,
): WorldRuntimeProjectionResult {
  return {
    worldId: value.worldId,
    ...(value.agentId !== undefined ? { agentId: value.agentId } : {}),
    consumerSurface: value.consumerSurface,
    ...(value.releaseAnchor !== undefined ? { releaseAnchor: value.releaseAnchor } : {}),
    checksum: value.checksum,
    selectedInputs: value.selectedInputs,
    trace: value.trace,
    payload: value.payload,
  };
}

export async function projectWorldRuntimePayload(
  client: Pick<PlatformClient, 'realm'>,
  input: WorldRuntimeProjectionRequest,
): Promise<WorldRuntimeProjectionResult> {
  const response = await client.realm.services.RuntimeProjectionsService.projectRuntimePayload(
    toRuntimeProjectionRequest(input),
  );
  return toWorldRuntimeProjectionResult(response as WorldRuntimeProjectionResult);
}

export const projection = {
  projectRuntimePayload: projectWorldRuntimePayload,
};
