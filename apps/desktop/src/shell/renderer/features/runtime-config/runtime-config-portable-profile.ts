import {
  parseNimiPortableAIProfile,
  type NimiPortableAIProfileInput,
} from '@nimiplatform/sdk/ai';

export type DesktopPortableAIProfileSummary = {
  readonly profileId: string;
  readonly title: string;
  readonly capabilities: readonly {
    readonly capabilityContract: string;
    readonly route: 'local' | 'cloud';
    readonly requiredFeatures: readonly string[];
    readonly hasDefaults: boolean;
  }[];
};

/**
 * Projects portable consumer intent for App UI. Provider/model targets,
 * bindings, machine selection, and readiness are not interpreted by Desktop.
 */
export function summarizeDesktopPortableAIProfile(
  input: NimiPortableAIProfileInput,
): DesktopPortableAIProfileSummary {
  const profile = parseNimiPortableAIProfile(input);
  return Object.freeze({
    profileId: profile.profileId,
    title: profile.title,
    capabilities: Object.freeze(Object.entries(profile.capabilities)
      .map(([capabilityContract, capability]) => Object.freeze({
        capabilityContract,
        route: capability.route,
        requiredFeatures: Object.freeze([...capability.requiredFeatures]),
        hasDefaults: capability.defaults !== undefined,
      }))
      .sort((left, right) => left.capabilityContract.localeCompare(right.capabilityContract))),
  });
}
