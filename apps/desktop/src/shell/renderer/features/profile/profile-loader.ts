import {
  isPendingSentRequestInContacts,
  type SocialContactSnapshot,
} from '../social/data/social-snapshot';
import type { HumanProfileSource } from './profile-model.js';

export type HumanProfileLoaderPorts = {
  readonly loadUserProfile: (id: string) => Promise<HumanProfileSource>;
  /** Owner contact-list relationship; the profile read does not carry it. */
  readonly isFriend: (id: string) => boolean;
  readonly contacts: () => SocialContactSnapshot | null | undefined;
};

// A failed profile read stays a failure. Cached contacts may describe the
// relationship of a profile that loaded, but never stand in for the profile.
export async function loadHumanProfileWithRelationship(
  profileId: string,
  ports: HumanProfileLoaderPorts,
): Promise<HumanProfileSource> {
  const profile = await ports.loadUserProfile(profileId);
  const isFriend = profile.isFriend ?? ports.isFriend(profileId);
  const isPendingFriendRequest = profile.isPendingFriendRequest
    ?? isPendingSentRequestInContacts(ports.contacts() ?? undefined, profileId);
  return { ...profile, isFriend, isPendingFriendRequest };
}
