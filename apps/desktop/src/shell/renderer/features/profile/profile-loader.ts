import type { HumanProfileSource } from './profile-model.js';
import { toHumanProfileData, type HumanProfileData } from './profile-model.js';
import { isPrivateProfileAccessError, toRestrictedHumanProfileData, type RestrictedHumanProfileSeed } from '../relationship/profile-private-state.js';

export async function loadContextualHumanProfile(
  profileId: string,
  ports: {
    loadUserProfile: (id: string) => Promise<HumanProfileSource>;
    loadRelationship: (id: string) => Promise<NonNullable<HumanProfileData['relationship']>>;
  },
  seed?: RestrictedHumanProfileSeed | null,
): Promise<HumanProfileData> {
  try { return toHumanProfileData(await ports.loadUserProfile(profileId)); }
  catch (error) {
    if (!seed || seed.id !== profileId || !isPrivateProfileAccessError(error)) throw error;
    const relationship = await ports.loadRelationship(profileId);
    return { ...toRestrictedHumanProfileData(seed), relationship, relationshipId: relationship.relationshipId,
      isFriend: relationship.state === 'active', isPendingFriendRequest: relationship.state === 'pending_outgoing' };
  }
}
