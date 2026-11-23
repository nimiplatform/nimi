import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import type { JsonObject } from '@nimiplatform/sdk/types';
import type { HumanProfileData } from './profile-model.js';

export const PROFILE_LIMITS = { displayName: 500, bio: 2000, city: 100, items: 20, language: 32, tag: 64 } as const;
export const PROFILE_GENDERS = ['MALE', 'FEMALE', 'NONBINARY', 'PREFER_NOT_SAY'] as const;
export type ProfileGender = typeof PROFILE_GENDERS[number] | '';

export type EditableProfileDraft = {
  displayName: string;
  bio: string;
  city: string;
  countryCode: string;
  gender: ProfileGender;
  languages: string[];
  tags: string[];
  avatarUrl: string | null;
  avatarResourceId: string | null;
  avatarMedia: RealmModel<'MediaDeliveryDto'> | null;
};

export type ProfileDraftFieldKey =
  | 'avatar'
  | 'displayName'
  | 'bio'
  | 'countryCode'
  | 'city'
  | 'gender'
  | 'languages'
  | 'tags';

export type ProfileDraftFieldErrors = Partial<{
  displayName: 'name' | 'displayNameLength';
  bio: 'bioLength';
  city: 'cityLength';
  languages: 'languages';
  tags: 'tags';
}>;

export function buildEditableProfileDraft(profile: HumanProfileData): EditableProfileDraft {
  return {
    displayName: profile.displayName,
    bio: profile.bio || '',
    city: profile.city || '',
    countryCode: profile.countryCode || '',
    gender: PROFILE_GENDERS.find((value) => value === profile.gender) || '',
    languages: [...profile.languages],
    tags: [...profile.tags],
    avatarUrl: profile.avatarUrl,
    avatarResourceId: profile.avatarResourceId ?? null,
    avatarMedia: profile.avatarMedia ?? null,
  };
}

export function parseProfileList(value: string): string[] {
  return [...new Set(value.split(/[,，、\n]/u).map((item) => item.trim()).filter(Boolean))];
}

function normalizeList(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function fields(draft: EditableProfileDraft): JsonObject {
  return {
    displayName: draft.displayName.trim(),
    bio: draft.bio.trim() || null,
    city: draft.city.trim() || null,
    countryCode: draft.countryCode || null,
    gender: draft.gender || null,
    languages: normalizeList(draft.languages),
    tags: normalizeList(draft.tags),
  };
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
// Updating one field must not replay the editor's old copy of other fields.
export function profileDraftPatch(baseline: EditableProfileDraft, draft: EditableProfileDraft): JsonObject {
  const before = fields(baseline);
  const after = fields(draft);
  const patch: JsonObject = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
  }
  if (
    baseline.avatarResourceId !== draft.avatarResourceId
    || (!draft.avatarResourceId && baseline.avatarUrl !== draft.avatarUrl)
  ) {
    if (draft.avatarResourceId) patch.avatarResourceId = draft.avatarResourceId;
    else {
      patch.avatarResourceId = null;
      patch.avatarUrl = draft.avatarUrl;
    }
  }
  return patch;
}

export function profileChangedFields(
  baseline: EditableProfileDraft,
  draft: EditableProfileDraft,
): ProfileDraftFieldKey[] {
  const patch = profileDraftPatch(baseline, draft);
  const ordered: ProfileDraftFieldKey[] = [];
  if ('avatarResourceId' in patch || 'avatarUrl' in patch) ordered.push('avatar');
  for (const key of ['displayName', 'bio', 'countryCode', 'city', 'gender', 'languages', 'tags'] as const) {
    if (key in patch) ordered.push(key);
  }
  return ordered;
}

export function profileDraftFieldErrors(draft: EditableProfileDraft): ProfileDraftFieldErrors {
  const errors: ProfileDraftFieldErrors = {};
  const trimmedName = draft.displayName.trim();
  if (!trimmedName) errors.displayName = 'name';
  else if (trimmedName.length > PROFILE_LIMITS.displayName) errors.displayName = 'displayNameLength';

  if (draft.bio.trim().length > PROFILE_LIMITS.bio) errors.bio = 'bioLength';
  if (draft.city.trim().length > PROFILE_LIMITS.city) errors.city = 'cityLength';

  const languages = normalizeList(draft.languages);
  if (languages.length > PROFILE_LIMITS.items || languages.some((value) => value.length > PROFILE_LIMITS.language)) {
    errors.languages = 'languages';
  }
  const tags = normalizeList(draft.tags);
  if (tags.length > PROFILE_LIMITS.items || tags.some((value) => value.length > PROFILE_LIMITS.tag)) {
    errors.tags = 'tags';
  }
  return errors;
}

export function profileDraftValidation(
  draft: EditableProfileDraft,
): 'name' | 'length' | 'languages' | 'tags' | null {
  const errors = profileDraftFieldErrors(draft);
  if (errors.displayName === 'name') return 'name';
  if (errors.displayName || errors.bio || errors.city) return 'length';
  if (errors.languages) return 'languages';
  if (errors.tags) return 'tags';
  return null;
}

export function previewProfileDraft(profile: HumanProfileData, draft: EditableProfileDraft): HumanProfileData {
  return {
    ...profile,
    ...draft,
    displayName: draft.displayName.trim() || profile.displayName,
    bio: draft.bio.trim() || null,
    city: draft.city.trim() || null,
    countryCode: draft.countryCode || null,
    gender: draft.gender || null,
    languages: normalizeList(draft.languages),
    tags: normalizeList(draft.tags),
  };
}
