#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const tablePath = path.join(repoRoot, '.nimi', 'spec', 'sdk', 'kernel', 'tables', 'connector-auth-acquisition-profiles.yaml');
const runtimeAuthProfilesPath = path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables', 'connector-auth-profiles.yaml');
const sdkOutPath = path.join(repoRoot, 'sdk', 'src', 'runtime', 'connector-auth-acquisition-profiles.generated.ts');
const desktopTauriOutPath = path.join(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'src',
  'main_parts',
  'connector_auth_acquisition_profiles_generated.rs',
);

const allowedProfileFields = new Set([
  'profile_id',
  'provider_auth_profile',
  'issuer',
  'client_id',
  'device_authorization_url',
  'device_token_url',
  'redirect_uri',
  'fallback_verification_url',
  'token_exchange_provider',
  'default_poll_interval_seconds',
  'min_poll_interval_seconds',
  'default_expires_in_seconds',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function requireNonEmptyString(entry, field, profileID) {
  const value = normalizeString(entry?.[field]);
  if (!value) {
    throw new Error(`profile ${profileID || '<unknown>'} must define non-empty ${field}`);
  }
  return value;
}

function requirePositiveInt(entry, field, profileID) {
  const raw = entry?.[field];
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw || '').trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`profile ${profileID} must define positive integer ${field}`);
  }
  return Math.trunc(value);
}

function requireHttpsUrl(entry, field, profileID) {
  const value = requireNonEmptyString(entry, field, profileID);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`profile ${profileID} ${field} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`profile ${profileID} ${field} must use https`);
  }
  return value;
}

function assertNoExtraFields(entry, profileID) {
  for (const field of Object.keys(entry || {})) {
    if (!allowedProfileFields.has(field)) {
      throw new Error(`profile ${profileID || '<unknown>'} uses unsupported field ${field}`);
    }
  }
}

function parseRuntimeAuthProfileIDs(raw) {
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const ids = new Set();
  for (const profile of profiles) {
    const id = normalizeLower(profile?.id);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function assertEntriesMatch(raw, profiles) {
  const entries = Array.isArray(raw?.entries)
    ? raw.entries.map(normalizeLower).filter(Boolean).sort()
    : [];
  const profileIDs = profiles.map((profile) => profile.profileId).sort();
  if (JSON.stringify(entries) !== JSON.stringify(profileIDs)) {
    throw new Error(`connector-auth-acquisition entries mismatch profiles entries=${JSON.stringify(entries)} profiles=${JSON.stringify(profileIDs)}`);
  }
}

function parseProfiles(raw, runtimeAuthProfileIDs) {
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const seenIDs = new Set();
  const parsed = profiles.map((entry) => {
    const profileId = normalizeLower(entry?.profile_id);
    if (!profileId) {
      throw new Error('connector-auth-acquisition-profiles.yaml contains profile with empty profile_id');
    }
    if (seenIDs.has(profileId)) {
      throw new Error(`connector-auth-acquisition-profiles.yaml duplicates profile_id ${profileId}`);
    }
    seenIDs.add(profileId);
    assertNoExtraFields(entry, profileId);

    const providerAuthProfile = normalizeLower(entry?.provider_auth_profile);
    if (!providerAuthProfile) {
      throw new Error(`profile ${profileId} must define provider_auth_profile`);
    }
    if (!runtimeAuthProfileIDs.has(providerAuthProfile)) {
      throw new Error(`profile ${profileId} references unknown provider_auth_profile ${providerAuthProfile}`);
    }

    const defaultPollIntervalSeconds = requirePositiveInt(entry, 'default_poll_interval_seconds', profileId);
    const minPollIntervalSeconds = requirePositiveInt(entry, 'min_poll_interval_seconds', profileId);
    const defaultExpiresInSeconds = requirePositiveInt(entry, 'default_expires_in_seconds', profileId);
    if (defaultPollIntervalSeconds < minPollIntervalSeconds) {
      throw new Error(`profile ${profileId} default_poll_interval_seconds must be >= min_poll_interval_seconds`);
    }

    return {
      profileId,
      providerAuthProfile,
      issuer: requireHttpsUrl(entry, 'issuer', profileId),
      clientId: requireNonEmptyString(entry, 'client_id', profileId),
      deviceAuthorizationUrl: requireHttpsUrl(entry, 'device_authorization_url', profileId),
      deviceTokenUrl: requireHttpsUrl(entry, 'device_token_url', profileId),
      redirectUri: requireHttpsUrl(entry, 'redirect_uri', profileId),
      fallbackVerificationUrl: requireHttpsUrl(entry, 'fallback_verification_url', profileId),
      tokenExchangeProvider: requireNonEmptyString(entry, 'token_exchange_provider', profileId),
      defaultPollIntervalSeconds,
      minPollIntervalSeconds,
      defaultExpiresInSeconds,
    };
  }).sort((left, right) => left.profileId.localeCompare(right.profileId));

  assertEntriesMatch(raw, parsed);
  return parsed;
}

function quoteTS(value) {
  return JSON.stringify(String(value));
}

function quoteRust(value) {
  return JSON.stringify(String(value));
}

function renderTS(profiles) {
  const records = profiles.map((profile) => (
    `  ${quoteTS(profile.profileId)}: {\n` +
    `    profileId: ${quoteTS(profile.profileId)},\n` +
    `    providerAuthProfile: ${quoteTS(profile.providerAuthProfile)},\n` +
    `    issuer: ${quoteTS(profile.issuer)},\n` +
    `    clientId: ${quoteTS(profile.clientId)},\n` +
    `    deviceAuthorizationUrl: ${quoteTS(profile.deviceAuthorizationUrl)},\n` +
    `    deviceTokenUrl: ${quoteTS(profile.deviceTokenUrl)},\n` +
    `    redirectUri: ${quoteTS(profile.redirectUri)},\n` +
    `    fallbackVerificationUrl: ${quoteTS(profile.fallbackVerificationUrl)},\n` +
    `    tokenExchangeProvider: ${quoteTS(profile.tokenExchangeProvider)},\n` +
    `    defaultPollIntervalSeconds: ${profile.defaultPollIntervalSeconds},\n` +
    `    minPollIntervalSeconds: ${profile.minPollIntervalSeconds},\n` +
    `    defaultExpiresInSeconds: ${profile.defaultExpiresInSeconds},\n` +
    `  },`
  )).join('\n');

  return `// Code generated by scripts/generate-sdk-connector-auth-acquisition-profiles.mjs. DO NOT EDIT.\n\n` +
    `export type ConnectorAuthAcquisitionProfileSpec = {\n` +
    `  profileId: string;\n` +
    `  providerAuthProfile: string;\n` +
    `  issuer: string;\n` +
    `  clientId: string;\n` +
    `  deviceAuthorizationUrl: string;\n` +
    `  deviceTokenUrl: string;\n` +
    `  redirectUri: string;\n` +
    `  fallbackVerificationUrl: string;\n` +
    `  tokenExchangeProvider: string;\n` +
    `  defaultPollIntervalSeconds: number;\n` +
    `  minPollIntervalSeconds: number;\n` +
    `  defaultExpiresInSeconds: number;\n` +
    `};\n\n` +
    `export const CONNECTOR_AUTH_ACQUISITION_PROFILES: Record<string, ConnectorAuthAcquisitionProfileSpec> = {\n${records}\n};\n`;
}

function renderRust(profiles) {
  const records = profiles.map((profile) => (
    `ConnectorAuthAcquisitionProfile {\n` +
    `        profile_id: ${quoteRust(profile.profileId)},\n` +
    `        device_authorization_url: ${quoteRust(profile.deviceAuthorizationUrl)},\n` +
    `        device_token_url: ${quoteRust(profile.deviceTokenUrl)},\n` +
    `    }`
  )).join(',\n    ');

  return `// Code generated by scripts/generate-sdk-connector-auth-acquisition-profiles.mjs. DO NOT EDIT.\n\n` +
    `#[derive(Debug, Clone, Copy)]\n` +
    `pub(super) struct ConnectorAuthAcquisitionProfile {\n` +
    `    pub profile_id: &'static str,\n` +
    `    pub device_authorization_url: &'static str,\n` +
    `    pub device_token_url: &'static str,\n` +
    `}\n\n` +
    `pub(super) const CONNECTOR_AUTH_ACQUISITION_PROFILES: &[ConnectorAuthAcquisitionProfile] =\n` +
    `    &[${records}];\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = YAML.parse(await fs.readFile(tablePath, 'utf8'));
  const runtimeAuthProfiles = YAML.parse(await fs.readFile(runtimeAuthProfilesPath, 'utf8'));
  const profiles = parseProfiles(raw, parseRuntimeAuthProfileIDs(runtimeAuthProfiles));
  const outputs = [
    {
      path: sdkOutPath,
      content: renderTS(profiles),
      label: 'SDK TypeScript',
    },
    {
      path: desktopTauriOutPath,
      content: renderRust(profiles),
      label: 'Desktop Tauri Rust',
    },
  ];

  if (check) {
    for (const output of outputs) {
      const current = await fs.readFile(output.path, 'utf8');
      if (current !== output.content) {
        throw new Error(`connector auth acquisition profile generated ${output.label} file is out of date`);
      }
    }
    return;
  }

  for (const output of outputs) {
    await fs.mkdir(path.dirname(output.path), { recursive: true });
    await fs.writeFile(output.path, output.content);
  }
}

main().catch((error) => {
  process.stderr.write(`generate-sdk-connector-auth-acquisition-profiles failed: ${String(error)}\n`);
  process.exit(1);
});
