import {
  createNimiRuntimeAgentSmokeVerificationSurface,
  type NimiRuntimeAgentSmokeVerificationSurface,
} from '@nimiplatform/sdk/runtime';
import { getRuntimePlatformProjection } from '../../src/shell/auth/runtime-platform.js';

export async function createTesterRuntimeAgentSmokeVerificationSurface(
  subjectUserId: string,
): Promise<NimiRuntimeAgentSmokeVerificationSurface> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  const runtime = projection.client.runtime;
  return createNimiRuntimeAgentSmokeVerificationSurface({
    getRuntime: () => ({
      appId: projection.client.appId ?? 'nimi.tester',
      auth: runtime.auth,
      appAuth: runtime.grants,
      agents: runtime.agents,
      health: runtime.health.bind(runtime),
    }),
    getSubjectUserId: () => subjectUserId,
  });
}
