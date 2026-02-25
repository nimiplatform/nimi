import type { CapabilityRequest, CredentialRef, ModelProfile, RoutingDecision } from '../types';
import { findCredentialRef, scoreProfile, type ModelRuntimeStats } from './scoring';

type BuildRoutingCandidatesInput = {
  request: CapabilityRequest;
  profiles: ModelProfile[];
  credentialRefs?: CredentialRef[];
  credentialRefsByProvider?: Record<string, CredentialRef[]>;
  statsByModelId?: Record<string, ModelRuntimeStats>;
};

export function buildRoutingCandidates(input: BuildRoutingCandidatesInput): RoutingDecision[] {
  const scored = input.profiles
    .map((profile) => {
      const ranked = scoreProfile(profile, input.request, input.statsByModelId?.[profile.id]);
      if (!ranked) {
        return null;
      }

      return {
        modelProfile: profile,
        credentialRef: findCredentialRef(profile, input.credentialRefs, input.credentialRefsByProvider),
        score: ranked.score,
        reason: ranked.reason,
        fallbacks: [],
      } satisfies RoutingDecision;
    })
    .filter(Boolean) as RoutingDecision[];

  scored.sort((a, b) => b.score - a.score);

  return scored.map((candidate, index) => ({
    ...candidate,
    fallbacks: scored.slice(index + 1).map((item) => item.modelProfile.id),
  }));
}
