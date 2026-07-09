import { buildNimiRuntimeScenarioJobIdentity } from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeGenerationScenarioIdentity = {
  readonly requestId: string;
  readonly idempotencyKey: string;
};

export type RuntimeGenerationScenarioIdentityInput = {
  readonly appId: string;
  readonly capabilityId: string;
  readonly scenarioId: string;
};

export function buildRuntimeGenerationScenarioIdentity(
  input: RuntimeGenerationScenarioIdentityInput,
): RuntimeGenerationScenarioIdentity {
  return buildNimiRuntimeScenarioJobIdentity(input);
}
