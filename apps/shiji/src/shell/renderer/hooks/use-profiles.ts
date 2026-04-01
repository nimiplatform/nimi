/**
 * use-profiles.ts — Learner profile management hook (SJ-SHELL-006, SJ-SHELL-007)
 *
 * Loads profiles from SQLite, syncs to Zustand store, provides create/update/switch.
 * Profile version auto-increments on update per SJ-SHELL-007.
 */
import { useEffect, useCallback } from 'react';
import { ulid } from 'ulid';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { LearnerProfile as StoreLearnerProfile } from '@renderer/app-shell/app-store.js';
import {
  sqliteGetLearnerProfiles,
  sqliteCreateLearnerProfile,
  sqliteUpdateLearnerProfile,
  sqliteSetActiveProfile,
} from '@renderer/bridge/sqlite-bridge.js';
import type { LearnerProfile as BridgeProfile } from '@renderer/bridge/sqlite-bridge.js';

function safeParseJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function bridgeToStore(raw: BridgeProfile): StoreLearnerProfile {
  return {
    id: raw.id,
    authUserId: raw.authUserId,
    displayName: raw.displayName,
    age: raw.age,
    communicationStyle: raw.communicationStyle,
    guardianGoals: raw.guardianGoals,
    profileVersion: raw.profileVersion,
    isActive: raw.isActive,
    encounterCompletedAt: raw.encounterCompletedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    strengthTags: safeParseJson<string[]>(raw.strengthTags, []),
    interestTags: safeParseJson<string[]>(raw.interestTags, []),
    supportNotes: safeParseJson<string[]>(raw.supportNotes, []),
    guardianGuidance: safeParseJson<Record<string, string>>(raw.guardianGuidance, {}),
  };
}

export type ProfileFormInput = {
  displayName: string;
  age: number;
  communicationStyle: string;
  guardianGoals: string;
  strengthTags: string[];
  interestTags: string[];
  supportNotes: string[];
  guardianGuidance: Record<string, string>;
};

export function useProfiles() {
  const authUser = useAppStore((s) => s.auth.user);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfile = useAppStore((s) => s.activeProfile);
  const profilesLoaded = useAppStore((s) => s.profilesLoaded);

  const syncFromSQLite = useCallback(async (authUserId: string): Promise<void> => {
    const raw = await sqliteGetLearnerProfiles(authUserId);
    const parsed = raw.map(bridgeToStore);
    const store = useAppStore.getState();
    store.setProfiles(parsed);
    store.setActiveProfile(parsed.find((p) => p.isActive) ?? null);
    store.setProfilesLoaded(true);
  }, []);

  useEffect(() => {
    if (!authUser || profilesLoaded) return;
    void syncFromSQLite(authUser.id);
  }, [authUser, profilesLoaded, syncFromSQLite]);

  const createProfile = useCallback(async (input: ProfileFormInput): Promise<StoreLearnerProfile> => {
    const user = useAppStore.getState().auth.user;
    if (!user) throw new Error('No authenticated user');
    const now = new Date().toISOString();
    const id = ulid();
    await sqliteCreateLearnerProfile({
      id,
      authUserId: user.id,
      displayName: input.displayName,
      age: input.age,
      communicationStyle: input.communicationStyle,
      guardianGoals: input.guardianGoals,
      strengthTags: JSON.stringify(input.strengthTags),
      interestTags: JSON.stringify(input.interestTags),
      supportNotes: JSON.stringify(input.supportNotes),
      guardianGuidance: JSON.stringify(input.guardianGuidance),
      createdAt: now,
      updatedAt: now,
    });
    // First profile: make it active
    if (useAppStore.getState().profiles.length === 0) {
      await sqliteSetActiveProfile(user.id, id);
    }
    await syncFromSQLite(user.id);
    const found = useAppStore.getState().profiles.find((p) => p.id === id);
    if (!found) throw new Error('Profile not found after create');
    return found;
  }, [syncFromSQLite]);

  const updateProfile = useCallback(async (id: string, input: ProfileFormInput): Promise<StoreLearnerProfile> => {
    const user = useAppStore.getState().auth.user;
    if (!user) throw new Error('No authenticated user');
    const existing = useAppStore.getState().profiles.find((p) => p.id === id);
    if (!existing) throw new Error(`Profile ${id} not found`);
    const now = new Date().toISOString();
    // SJ-SHELL-007: profileVersion auto-increments on guardian edit — handled by Rust update_learner_profile command
    await sqliteUpdateLearnerProfile({
      id,
      displayName: input.displayName,
      age: input.age,
      communicationStyle: input.communicationStyle,
      guardianGoals: input.guardianGoals,
      strengthTags: JSON.stringify(input.strengthTags),
      interestTags: JSON.stringify(input.interestTags),
      supportNotes: JSON.stringify(input.supportNotes),
      guardianGuidance: JSON.stringify(input.guardianGuidance),
      encounterCompletedAt: existing.encounterCompletedAt,
      updatedAt: now,
    });
    await syncFromSQLite(user.id);
    const updated = useAppStore.getState().profiles.find((p) => p.id === id);
    return updated ?? existing;
  }, [syncFromSQLite]);

  const switchProfile = useCallback(async (profileId: string): Promise<void> => {
    const user = useAppStore.getState().auth.user;
    if (!user) throw new Error('No authenticated user');
    await sqliteSetActiveProfile(user.id, profileId);
    await syncFromSQLite(user.id);
  }, [syncFromSQLite]);

  return { profiles, activeProfile, profilesLoaded, createProfile, updateProfile, switchProfile };
}
