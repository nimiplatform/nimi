/**
 * User-defined AI Profile local persistence layer.
 *
 * Runtime-built-in profiles come from the host surface (`aiProfile.list()`).
 * This module handles user-created profiles stored in localStorage,
 * plus import/export serialization.
 */

import { validateAIProfile, type AIProfile } from '@nimiplatform/sdk/mod';

const STORAGE_KEY = 'nimi.ai-profiles.user.v1';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function loadUserProfiles(): AIProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistUserProfiles(profiles: AIProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function saveUserProfile(profile: AIProfile): void {
  const existing = loadUserProfiles();
  const index = existing.findIndex((p) => p.profileId === profile.profileId);
  if (index >= 0) {
    existing[index] = profile;
  } else {
    existing.push(profile);
  }
  persistUserProfiles(existing);
}

export function deleteUserProfile(profileId: string): void {
  const existing = loadUserProfiles();
  persistUserProfiles(existing.filter((p) => p.profileId !== profileId));
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export function exportProfiles(profiles: AIProfile[]): string {
  return JSON.stringify(profiles, null, 2);
}

export type ImportResult = {
  imported: AIProfile[];
  errors: string[];
};

export function importProfiles(json: string): ImportResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { imported: [], errors: ['Invalid JSON'] };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const imported: AIProfile[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = validateAIProfile(items[i]);
    if (result.valid) {
      imported.push(items[i] as AIProfile);
    } else {
      errors.push(`Item ${i}: ${result.errors.join(', ')}`);
    }
  }

  return { imported, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateProfileId(): string {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyUserProfile(profileId?: string): AIProfile {
  return {
    profileId: profileId || generateProfileId(),
    title: '',
    description: '',
    tags: [],
    capabilities: {},
  };
}
