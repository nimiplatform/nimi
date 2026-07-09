import { buildRuntimeGenerationScenarioIdentity } from '@nimiplatform/kit/features/generation/runtime';

export const TESTER_APP_ID = 'nimi.tester';

export function runtimeJobIdentity(capabilityId: string, scenarioId: string): {
  requestId: string;
  idempotencyKey: string;
} {
  return buildRuntimeGenerationScenarioIdentity({ appId: TESTER_APP_ID, capabilityId, scenarioId });
}
