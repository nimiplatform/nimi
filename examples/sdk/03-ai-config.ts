/**
 * Save a Local `text.generate` intent for this App.
 *
 * AIConfig is one complete value per App: an overwrite replaces every
 * capability, so keep the ones the App already has. The intent names no model,
 * connector or machine selection; Runtime chooses the implementation when work
 * starts. A revision conflict means another writer saved first.
 */

import type {
  NimiAIConfigOverwriteResult,
  NimiLocalAppClient,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk';

export async function useLocalTextGeneration(client: NimiLocalAppClient): Promise<NimiAIConfigOverwriteResult> {
  const current = await client.aiConfig.get();
  const textGeneration: NimiPortableAppAIConfigIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  const otherCapabilities = (current.config?.capabilities ?? [])
    .filter((capability) => capability.capabilityContract !== textGeneration.capabilityContract);
  const result = await client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [...otherCapabilities, textGeneration],
  });
  // On `conflict`, show `result.config` to the owner and let them decide again;
  // do not retry blindly with the newer revision.
  return result;
}
