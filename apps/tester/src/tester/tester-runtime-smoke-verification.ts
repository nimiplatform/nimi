import {
  createRuntimeAgentSmokeVerificationSurface,
  type RuntimeAgentSmokeVerificationSurface,
} from '@nimiplatform/sdk/runtime';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';

export async function createTesterRuntimeAgentSmokeVerificationSurface(
  subjectUserId: string,
): Promise<RuntimeAgentSmokeVerificationSurface> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  return createRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => projection.client.runtime,
    getSubjectUserId: () => subjectUserId,
  });
}
