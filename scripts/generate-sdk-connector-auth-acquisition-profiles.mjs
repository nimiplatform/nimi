#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const tablePath = path.join(repoRoot, 'config', 'sdks-connector-auth-acquisition-profiles.yaml');
const runtimeAuthProfilesPath = path.join(repoRoot, 'config', 'runtime-connector-auth-profiles.yaml');
const sdkVnextOutPath = path.join(repoRoot, 'sdks', 'typescript', 'runtime', 'connector-auth-acquisition-profiles.generated.ts');

const allowedProfileFields = new Set([
  'profile_id',
  'provider_auth_profile',
  'issuer',
  'initial_client_id',
  'agent_name_hint',
  'authorization_url',
  'token_url',
  'jwks_url',
  'resource',
  'scopes',
  'callback_host',
  'callback_path',
  'acquisition_timeout_seconds',
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
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`profile ${profileID} ${field} must be an exact https URL`);
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

function parseScopes(entry, profileID) {
  const scopes = Array.isArray(entry?.scopes) ? entry.scopes.map(normalizeString) : [];
  if (scopes.length === 0 || scopes.some((scope) => !scope || /\s/u.test(scope)) || new Set(scopes).size !== scopes.length) {
    throw new Error(`profile ${profileID} must define unique non-empty scopes`);
  }
  return scopes;
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
    // The browser callback is always a fresh 127.0.0.1 port with this fixed
    // path; only the port may vary between authorization attempts.
    const callbackHost = requireNonEmptyString(entry, 'callback_host', profileId);
    if (callbackHost !== '127.0.0.1') {
      throw new Error(`profile ${profileId} callback_host must be the 127.0.0.1 loopback address`);
    }
    const callbackPath = requireNonEmptyString(entry, 'callback_path', profileId);
    if (!/^\/[A-Za-z0-9/_-]+$/u.test(callbackPath)) {
      throw new Error(`profile ${profileId} callback_path must be an absolute path without query or fragment`);
    }
    const acquisitionTimeoutSeconds = requirePositiveInt(entry, 'acquisition_timeout_seconds', profileId);
    if (acquisitionTimeoutSeconds > 3600) {
      throw new Error(`profile ${profileId} acquisition_timeout_seconds must not exceed 3600`);
    }

    return {
      profileId,
      providerAuthProfile,
      issuer: requireHttpsUrl(entry, 'issuer', profileId),
      initialClientId: requireNonEmptyString(entry, 'initial_client_id', profileId),
      agentNameHint: requireNonEmptyString(entry, 'agent_name_hint', profileId),
      authorizationUrl: requireHttpsUrl(entry, 'authorization_url', profileId),
      tokenUrl: requireHttpsUrl(entry, 'token_url', profileId),
      jwksUrl: requireHttpsUrl(entry, 'jwks_url', profileId),
      resource: requireHttpsUrl(entry, 'resource', profileId),
      scopes: parseScopes(entry, profileId),
      callbackHost,
      callbackPath,
      acquisitionTimeoutSeconds,
    };
  }).sort((left, right) => left.profileId.localeCompare(right.profileId));

  assertEntriesMatch(raw, parsed);
  return parsed;
}

function quoteTS(value) {
  return JSON.stringify(String(value));
}

function renderTS(profiles) {
  const lines = [
    '// Code generated by scripts/generate-sdk-connector-auth-acquisition-profiles.mjs. DO NOT EDIT.',
    '',
    'export type ConnectorAuthAcquisitionProfileSpec = {',
    '  profileId: string;',
    '  providerAuthProfile: string;',
    '  issuer: string;',
    '  initialClientId: string;',
    '  agentNameHint: string;',
    '  authorizationUrl: string;',
    '  tokenUrl: string;',
    '  jwksUrl: string;',
    '  resource: string;',
    '  scopes: readonly string[];',
    '  callbackHost: string;',
    '  callbackPath: string;',
    '  acquisitionTimeoutSeconds: number;',
    '};',
    '',
    'export const CONNECTOR_AUTH_ACQUISITION_PROFILES: Record<string, ConnectorAuthAcquisitionProfileSpec> = {',
  ];
  for (const profile of profiles) {
    lines.push(
      `  ${quoteTS(profile.profileId)}: {`,
      `    profileId: ${quoteTS(profile.profileId)},`,
      `    providerAuthProfile: ${quoteTS(profile.providerAuthProfile)},`,
      `    issuer: ${quoteTS(profile.issuer)},`,
      `    initialClientId: ${quoteTS(profile.initialClientId)},`,
      `    agentNameHint: ${quoteTS(profile.agentNameHint)},`,
      `    authorizationUrl: ${quoteTS(profile.authorizationUrl)},`,
      `    tokenUrl: ${quoteTS(profile.tokenUrl)},`,
      `    jwksUrl: ${quoteTS(profile.jwksUrl)},`,
      `    resource: ${quoteTS(profile.resource)},`,
      `    scopes: [${profile.scopes.map(quoteTS).join(', ')}],`,
      `    callbackHost: ${quoteTS(profile.callbackHost)},`,
      `    callbackPath: ${quoteTS(profile.callbackPath)},`,
      `    acquisitionTimeoutSeconds: ${profile.acquisitionTimeoutSeconds},`,
      '  },',
    );
  }
  lines.push('};', '');
  return lines.join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = YAML.parse(await fs.readFile(tablePath, 'utf8'));
  const runtimeAuthProfiles = YAML.parse(await fs.readFile(runtimeAuthProfilesPath, 'utf8'));
  const profiles = parseProfiles(raw, parseRuntimeAuthProfileIDs(runtimeAuthProfiles));
  const outputs = [{
    path: sdkVnextOutPath,
    content: renderTS(profiles),
    label: 'vNext SDK TypeScript',
  }];

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
