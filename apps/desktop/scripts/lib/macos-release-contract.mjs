import {
  createPublicKey,
  verify as verifyBytes,
} from 'node:crypto';

export const MACOS_RELEASE_RECORDS = Object.freeze([
  Object.freeze({
    executableRole: 'nimi_runtime_service',
    recordFilename: 'nimi_runtime_service.release-trust-record.json',
    servicePrincipal: '_nimiruntime',
    signingIdentifier: 'ai.nimi.runtime',
    trustSetId: 'nimi-runtime-production-v1',
  }),
  Object.freeze({
    executableRole: 'nimi_desktop',
    recordFilename: 'nimi_desktop.release-trust-record.json',
    servicePrincipal: 'active_console_user',
    signingIdentifier: 'ai.nimi.apps.nimi.desktop',
    trustSetId: 'nimi-desktop-production-v1',
  }),
  Object.freeze({
    executableRole: 'nimi_local_app_host',
    recordFilename: 'nimi_local_app_host.release-trust-record.json',
    servicePrincipal: 'verified_desktop_supervised_active_console_user',
    signingIdentifier: 'ai.nimi.apps.nimi.local-app-host',
    trustSetId: 'nimi-local-development-host-macos-production-v1',
  }),
]);
export const MACOS_RELEASE_RECORD_SIGNER_PATH = '/usr/local/libexec/nimi-release-record-signer';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function readMacOSProductionReleaseInputs(env = process.env, now = new Date()) {
  const releaseId = releaseText(requireEnv(env, 'NIMI_MACOS_RELEASE_ID'), 'release id');
  const buildId = releaseText(requireEnv(env, 'NIMI_MACOS_BUILD_ID'), 'build id');
  const rootKeyId = releaseText(requireEnv(env, 'NIMI_PLATFORM_RELEASE_ROOT_KEY_ID'), 'root key id');
  const rootPublicKey = exactBase64URL(requireEnv(env, 'NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL'), 32, 'root public key');
  const generation = exactPositiveInteger(requireEnv(env, 'NIMI_MACOS_RELEASE_GENERATION'), 'release generation');
  const validFrom = exactRFC3339Second(requireEnv(env, 'NIMI_MACOS_RELEASE_VALID_FROM'), 'valid from');
  const expiresAt = exactRFC3339Second(requireEnv(env, 'NIMI_MACOS_RELEASE_EXPIRES_AT'), 'expires at');
  const nowMs = now.getTime();
  if (!(validFrom.date.getTime() <= nowMs && nowMs < expiresAt.date.getTime())) {
    fail('macOS release validity interval does not contain the build time');
  }
  if (validFrom.date.getTime() >= expiresAt.date.getTime()) fail('macOS release validity interval is empty');
  const teamId = exactTeamId(requireEnv(env, 'NIMI_MACOS_TEAM_ID'));
  const applicationIdentity = exactIdentity(requireEnv(env, 'NIMI_MACOS_APPLICATION_SIGNING_IDENTITY'), 'Developer ID Application:');
  const installerIdentity = exactIdentity(requireEnv(env, 'NIMI_MACOS_INSTALLER_SIGNING_IDENTITY'), 'Developer ID Installer:');
  const notaryProfile = releaseText(requireEnv(env, 'NIMI_NOTARYTOOL_KEYCHAIN_PROFILE'), 'notary keychain profile');
  const notaryKeychain = optionalAbsolutePath(env.NIMI_NOTARYTOOL_KEYCHAIN);
  return Object.freeze({
    applicationIdentity,
    buildId,
    expiresAt: expiresAt.text,
    generation,
    installerIdentity,
    notaryKeychain,
    notaryProfile,
    recordSignerPath: MACOS_RELEASE_RECORD_SIGNER_PATH,
    releaseId,
    rootKeyId,
    rootPublicKeyB64URL: rootPublicKey.toString('base64url'),
    teamId,
    validFrom: validFrom.text,
  });
}

export function createMacOSReleaseTrustRecord(input) {
  const role = MACOS_RELEASE_RECORDS.find((candidate) => candidate.executableRole === input?.role?.executableRole);
  if (!role || role !== input.role) fail('macOS release role is not canonical');
  const payload = {
    artifact_sha256: lowerHex(input.codeIdentity?.artifactSha256, 64, 'artifact sha256'),
    build_id: releaseText(input.buildId, 'build id'),
    compatible_peer_release_ids: [releaseText(input.releaseId, 'release id')],
    environment: 'production',
    executable_role: role.executableRole,
    expires_at: exactRFC3339Second(input.expiresAt, 'expires at').text,
    generation: exactPositiveInteger(input.generation, 'release generation'),
    identity_class: 'developer_id_application',
    linux_manifest_key_id: '',
    macos_cdhash: macOSCDHash(input.codeIdentity?.cdhash),
    macos_designated_requirement: exactRequirement(input.codeIdentity?.designatedRequirement),
    macos_hardened_runtime_required: true,
    macos_leaf_spki_sha256: '',
    macos_notarization_required: true,
    macos_team_id: exactTeamId(input.codeIdentity?.teamId),
    os_profile: 'macos',
    os_service_principal: role.servicePrincipal,
    protected_local_protocol_version: '1',
    release_id: releaseText(input.releaseId, 'release id'),
    root_key_id: releaseText(input.rootKeyId, 'root key id'),
    schema_version: 2,
    signature_algorithm: 'ed25519',
    signer_policy_id: 'nimi-production-release-signing-policy',
    trust_set_id: role.trustSetId,
    valid_from: exactRFC3339Second(input.validFrom, 'valid from').text,
    windows_chain_policy_ref: '',
    windows_leaf_spki_sha256: '',
  };
  if (input.codeIdentity.signingIdentifier !== role.signingIdentifier) {
    fail('macOS release role signing identifier mismatch');
  }
  const canonicalPayload = canonicalJSON(payload);
  if (typeof input.signRecord !== 'function') fail('macOS release record signer is required');
  const signature = exactBase64URL(input.signRecord(canonicalPayload), 64, 'record signature').toString('base64url');
  const encoded = canonicalJSON({ ...payload, signature });
  if (Buffer.byteLength(encoded) > 64 * 1024) fail('macOS release record exceeds the fixed bound');
  return Object.freeze({ encoded, record: Object.freeze({ ...payload, signature }), role });
}

export function verifyMacOSReleaseTrustRecordSignature(encoded, publicKeyB64URL) {
  const value = JSON.parse(encoded);
  const signature = exactBase64URL(value.signature, 64, 'record signature');
  delete value.signature;
  const publicRaw = exactBase64URL(publicKeyB64URL, 32, 'root public key');
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicRaw]),
    format: 'der',
    type: 'spki',
  });
  return canonicalJSON({ ...value, signature: signature.toString('base64url') }) === encoded
    && verifyBytes(null, Buffer.from(canonicalJSON(value)), publicKey, signature);
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('release record contains a non-canonical value');
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) fail(`missing required macOS release input: ${name}`);
  return value;
}

function exactBase64URL(value, length, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) fail(`${label} is not canonical base64url`);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (length !== undefined && decoded.length !== length)) {
    fail(`${label} is not canonical base64url`);
  }
  return decoded;
}

function exactPositiveInteger(value, label) {
  const text = String(value);
  if (!/^[1-9][0-9]*$/u.test(text)) fail(`${label} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) fail(`${label} exceeds the safe integer range`);
  return parsed;
}

function exactRFC3339Second(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) {
    fail(`${label} must be RFC3339 UTC at second precision`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value) {
    fail(`${label} is not a real RFC3339 instant`);
  }
  return { date, text: value };
}

function exactRequirement(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
    || value.trim() !== value || !/^[\x20-\x7E]+$/u.test(value)) fail('designated requirement is invalid');
  return value;
}

function exactTeamId(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9]{10}$/u.test(value)) fail('macOS Team ID is invalid');
  return value;
}

function macOSCDHash(value) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) fail('macOS CDHash is invalid');
  return value;
}

function lowerHex(value, length, label) {
  if (typeof value !== 'string' || value.length !== length || !/^[a-f0-9]+$/u.test(value)) fail(`${label} is invalid`);
  return value;
}

function releaseText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value
    || !/^[\x21-\x7E]+$/u.test(value) || /[\\/]/u.test(value)) fail(`${label} is invalid`);
  return value;
}

function exactIdentity(value, prefix) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || value.trim() !== value || !/^[\x20-\x7E]+$/u.test(value)) {
    fail('signing identity is invalid');
  }
  const identity = value;
  if (!identity.startsWith(prefix) || !identity.includes('(') || !identity.endsWith(')')) {
    fail(`signing identity must be an exact ${prefix} identity name`);
  }
  return identity;
}

function optionalAbsolutePath(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !value.startsWith('/') || value.trim() !== value || value.includes('\0')) {
    fail('notary keychain path must be absolute');
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}
