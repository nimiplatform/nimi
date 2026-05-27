import { LocalRecommendationFeedCapability } from './generated/runtime/v1/local_runtime_types.js';

export type LocalRecommendationFeedCapabilityId = 'chat' | 'image' | 'video';

const LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS = [
  [LocalRecommendationFeedCapability.CHAT, 'chat'],
  [LocalRecommendationFeedCapability.IMAGE, 'image'],
  [LocalRecommendationFeedCapability.VIDEO, 'video'],
] as const satisfies readonly (readonly [
  LocalRecommendationFeedCapability,
  LocalRecommendationFeedCapabilityId,
])[];

export const LOCAL_RECOMMENDATION_FEED_CAPABILITY_IDS = Object.freeze(
  LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS.map(([, id]) => id),
) as readonly LocalRecommendationFeedCapabilityId[];

export function parseLocalRecommendationFeedCapabilityId(
  value: unknown,
): LocalRecommendationFeedCapabilityId | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of LOCAL_RECOMMENDATION_FEED_CAPABILITY_PAIRS) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === `local_recommendation_feed_capability_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function normalizeLocalRecommendationFeedCapabilityId(
  value: unknown,
  fallback: LocalRecommendationFeedCapabilityId = 'chat',
): LocalRecommendationFeedCapabilityId {
  return parseLocalRecommendationFeedCapabilityId(value) ?? fallback;
}

export function toLocalRecommendationFeedCapabilityRequestValue(value: unknown): string {
  return normalizeLocalRecommendationFeedCapabilityId(value);
}
