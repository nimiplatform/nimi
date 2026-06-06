import { validateAIProfile, type AIProfile } from './ai-config.js';

export type AIProfileParseOptions = {
  readonly label?: string;
  readonly allowMissingOptionalFields?: boolean;
};

export type AccountProfileLibraryOrigin = 'account-default' | 'user' | 'imported';

export type AccountProfileLibraryProfile = {
  readonly profileId: string;
  readonly origin: Exclude<AccountProfileLibraryOrigin, 'account-default'>;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly profile: AIProfile;
};

export type AccountProfileLibraryIndexEntry = {
  readonly profileId: string;
  readonly title: string;
  readonly origin: AccountProfileLibraryOrigin;
  readonly relativePath: string;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly updatedAt: string;
};

export type AccountProfileLibraryProjection = {
  readonly accountId: string;
  readonly libraryPath: string;
  readonly index: {
    readonly schemaVersion: number;
    readonly accountId: string;
    readonly updatedAt: string;
    readonly entries: readonly AccountProfileLibraryIndexEntry[];
  };
  readonly profiles: readonly AccountProfileLibraryProfile[];
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid payload`);
  }
  return value as Record<string, unknown>;
}

export function parseAIProfile(value: unknown, options: AIProfileParseOptions = {}): AIProfile {
  const label = options.label ?? 'AIProfile payload';
  const record = asRecord(value, label);
  const profileId = String(record.profileId || '').trim();
  const title = String(record.title || '').trim();
  if (!profileId) {
    throw new Error(`${label} is missing profileId`);
  }
  if (!title) {
    throw new Error(`${label} is missing title`);
  }

  const description = typeof record.description === 'string'
    ? record.description
    : options.allowMissingOptionalFields
      ? ''
      : null;
  if (description === null) {
    throw new Error(`${label} description must be a string`);
  }
  if (!Array.isArray(record.tags)) {
    if (!options.allowMissingOptionalFields) {
      throw new Error(`${label} tags must be an array`);
    }
  }
  if (!record.capabilities || typeof record.capabilities !== 'object'
    || Array.isArray(record.capabilities)) {
    throw new Error(`${label} capabilities must be an object`);
  }

  const profile: AIProfile = {
    profileId,
    title,
    description,
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => String(tag || '')).filter(Boolean)
      : [],
    capabilities: record.capabilities as AIProfile['capabilities'],
  };
  const validation = validateAIProfile(profile);
  if (!validation.valid) {
    throw new Error(`${label} is invalid: ${validation.errors.join('; ')}`);
  }
  return profile;
}

export function parseAccountProfileLibraryOrigin(value: unknown): AccountProfileLibraryOrigin {
  const origin = String(value || '').trim();
  if (origin === 'account-default' || origin === 'user' || origin === 'imported') {
    return origin;
  }
  throw new Error(`account profile library returned an invalid origin: ${origin}`);
}

export function parseAccountProfileLibraryProfile(value: unknown): AccountProfileLibraryProfile {
  const record = asRecord(value, 'library profile');
  const origin = parseAccountProfileLibraryOrigin(record.origin);
  if (origin === 'account-default') {
    throw new Error('account profile library projected the Account Default Profile as editable');
  }
  return {
    profileId: String(record.profileId || '').trim(),
    origin,
    editable: record.editable === true,
    removable: record.removable === true,
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
    profile: parseAIProfile(record.profile, {
      label: 'library AIProfile payload',
      allowMissingOptionalFields: true,
    }),
  };
}

export function parseAccountProfileLibraryIndexEntry(value: unknown): AccountProfileLibraryIndexEntry {
  const record = asRecord(value, 'library index entry');
  return {
    profileId: String(record.profileId || '').trim(),
    title: String(record.title || ''),
    origin: parseAccountProfileLibraryOrigin(record.origin),
    relativePath: String(record.relativePath || ''),
    editable: record.editable === true,
    removable: record.removable === true,
    updatedAt: String(record.updatedAt || ''),
  };
}

export function parseAccountProfileLibraryProjection(value: unknown): AccountProfileLibraryProjection {
  const record = asRecord(value, 'account profile library');
  const index = asRecord(record.index, 'account profile library index');
  const entries = Array.isArray(index.entries)
    ? index.entries.map(parseAccountProfileLibraryIndexEntry)
    : [];
  const profiles = Array.isArray(record.profiles)
    ? record.profiles.map(parseAccountProfileLibraryProfile)
    : [];
  return {
    accountId: String(record.accountId || ''),
    libraryPath: String(record.libraryPath || ''),
    index: {
      schemaVersion: Number(index.schemaVersion || 0),
      accountId: String(index.accountId || ''),
      updatedAt: String(index.updatedAt || ''),
      entries,
    },
    profiles,
  };
}

export function parseExportedAccountProfileLibraryProfiles(value: unknown): AIProfile[] {
  if (!Array.isArray(value)) {
    throw new Error('account profile library export returned an invalid payload');
  }
  return value.map((profile) => parseAIProfile(profile, {
    label: 'library AIProfile payload',
    allowMissingOptionalFields: true,
  }));
}
