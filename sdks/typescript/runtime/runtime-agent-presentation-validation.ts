import {
  AgentPresentationBackendKind,
  type AgentPresentationProfile,
  type LocalAgentRecord,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentPresentationProfileReadProjection,
} from './runtime-agent-inspect-types';

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const BARE_REF = /^[A-Za-z0-9][A-Za-z0-9._@+~-]*$/u;
const NAMESPACE = /^[a-z][a-z0-9_.+-]{0,63}$/u;
const RFC3986_TAIL_BYTE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]$/u;
const FORBIDDEN_DIRECT_NAMESPACES = new Set(['file', 'data', 'http', 'https']);

export function normalizeNimiRuntimeAgentPresentationRevision(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return null;
  }
  try {
    return BigInt(value) <= MAX_UINT64 ? value : null;
  } catch {
    return null;
  }
}

export function isNimiRuntimeAgentPresentationOpaqueRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || !isASCII(value)) {
    return false;
  }
  if (isWindowsDrivePath(value)) {
    return false;
  }

  const colon = value.indexOf(':');
  if (colon < 0) {
    return value.length <= 256 && BARE_REF.test(value) && isSafeRefPass(value);
  }
  if (value.length > 2048) {
    return false;
  }
  const namespace = value.slice(0, colon);
  const tail = value.slice(colon + 1);
  if (!NAMESPACE.test(namespace) || tail.length === 0 || FORBIDDEN_DIRECT_NAMESPACES.has(namespace)) {
    return false;
  }
  for (let index = 0; index < tail.length; index += 1) {
    const character = tail[index] as string;
    if (character === '%') {
      if (index + 2 >= tail.length || !isHex(tail[index + 1]) || !isHex(tail[index + 2])) {
        return false;
      }
      index += 2;
      continue;
    }
    if (!RFC3986_TAIL_BYTE.test(character)) {
      return false;
    }
  }

  const decodedTail = percentDecodeOnce(tail);
  if (!isSafeRefPass(tail) || !isSafeRefPass(decodedTail)) {
    return false;
  }
  if (namespace === 'profile_media_url') {
    return isGoCompatibleProfileMediaURL(tail);
  }
  return !tail.includes('://') && !decodedTail.includes('://');
}

export function normalizeNimiRuntimeAgentPresentationVoiceReference(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (!value) {
    return '';
  }
  if (value.trim() !== value) {
    return null;
  }
  const colon = value.indexOf(':');
  if (colon < 0) {
    return null;
  }
  const kind = value.slice(0, colon);
  const suffix = value.slice(colon + 1);
  if (
    (kind !== 'preset_voice_id' && kind !== 'voice_asset_id')
    || suffix.length === 0
    || suffix.trim() !== suffix
  ) {
    return null;
  }
  return `${kind}:${suffix}`;
}

export function projectNimiRuntimeAgentPresentationRecord(
  value: Pick<LocalAgentRecord, 'presentationProfile' | 'presentationProfileRevision'> | unknown,
): NimiRuntimeAgentPresentationProfileReadProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { profile: null, committedRevision: null };
  }
  const record = value as Record<string, unknown>;
  const committedRevision = normalizeNimiRuntimeAgentPresentationRevision(record.presentationProfileRevision);
  if (committedRevision === null) {
    return { profile: null, committedRevision: null };
  }
  if (record.presentationProfile === undefined || record.presentationProfile === null) {
    return { profile: null, committedRevision };
  }
  const profile = projectPersistedPresentationProfile(record.presentationProfile, committedRevision);
  return profile
    ? { profile, committedRevision }
    : { profile: null, committedRevision: null };
}

function projectPersistedPresentationProfile(
  value: unknown,
  committedRevision: string,
): NimiRuntimeAgentPresentationProfileProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const profile = value as Record<string, unknown>;
  const revision = normalizeNimiRuntimeAgentPresentationRevision(profile.revision);
  if (revision === null || revision === '0' || revision !== committedRevision) {
    return null;
  }
  if (typeof profile.avatarAutoplay !== 'boolean') {
    return null;
  }
  const backendKind = projectBackendKind(profile.backendKind);
  const avatarAssetRef = projectOptionalOpaqueRef(profile.avatarAssetRef);
  const expressionProfileRef = projectOptionalOpaqueRef(profile.expressionProfileRef);
  const idlePreset = projectOptionalOpaqueRef(profile.idlePreset);
  const interactionPolicyRef = projectOptionalOpaqueRef(profile.interactionPolicyRef);
  const backgroundAssetRef = projectOptionalOpaqueRef(profile.backgroundAssetRef);
  const defaultVoiceReference = normalizeNimiRuntimeAgentPresentationVoiceReference(profile.defaultVoiceReference);
  if (
    avatarAssetRef === undefined
    || expressionProfileRef === undefined
    || idlePreset === undefined
    || interactionPolicyRef === undefined
    || backgroundAssetRef === undefined
    || defaultVoiceReference === null
    || defaultVoiceReference !== profile.defaultVoiceReference
  ) {
    return null;
  }
  if (avatarAssetRef) {
    if (!backendKind) {
      return null;
    }
  } else if (
    profile.backendKind !== AgentPresentationBackendKind.UNSPECIFIED
    || expressionProfileRef
    || idlePreset
    || interactionPolicyRef
  ) {
    return null;
  }
  if (!avatarAssetRef && !defaultVoiceReference && !backgroundAssetRef && !profile.avatarAutoplay) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef: avatarAssetRef || null,
    expressionProfileRef: expressionProfileRef || null,
    idlePreset: idlePreset || null,
    interactionPolicyRef: interactionPolicyRef || null,
    defaultVoiceReference: defaultVoiceReference || null,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetRef: backgroundAssetRef || null,
  };
}

function projectOptionalOpaqueRef(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (!value) {
    return '';
  }
  return isNimiRuntimeAgentPresentationOpaqueRef(value) ? value : undefined;
}

function projectBackendKind(value: unknown): NimiRuntimeAgentPresentationProfileProjection['backendKind'] | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  switch (value) {
    case AgentPresentationBackendKind.VRM:
      return 'vrm';
    case AgentPresentationBackendKind.LIVE2D:
      return 'live2d';
    case AgentPresentationBackendKind.SPRITE2D:
      return 'sprite2d';
    case AgentPresentationBackendKind.CANVAS2D:
      return 'canvas2d';
    case AgentPresentationBackendKind.VIDEO:
      return 'video';
    default:
      return null;
  }
}

function isASCII(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
}

function isWindowsDrivePath(value: string): boolean {
  return value.length >= 2 && /^[A-Za-z]$/u.test(value[0] as string) && value[1] === ':';
}

function isHex(value: string | undefined): boolean {
  return typeof value === 'string' && /^[0-9A-Fa-f]$/u.test(value);
}

function percentDecodeOnce(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '%') {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(value.charCodeAt(index));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function isGoCompatibleProfileMediaURL(value: string): boolean {
  const prefix = 'https://';
  if (!value.startsWith(prefix)) {
    return false;
  }
  const remainder = value.slice(prefix.length);
  const authorityEnd = remainder.search(/[/?#]/u);
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  if (!authority || authority.includes('@')) {
    return false;
  }
  if (authority.startsWith('[')) {
    return isGoCompatibleBracketedHost(authority);
  }
  if (authority.includes('[') || authority.includes(']') || authority.includes('%')) {
    return false;
  }
  const firstColon = authority.indexOf(':');
  if (firstColon < 0) {
    return true;
  }
  if (firstColon !== authority.lastIndexOf(':')) {
    return false;
  }
  return /^[0-9]*$/u.test(authority.slice(firstColon + 1));
}

function isGoCompatibleBracketedHost(authority: string): boolean {
  const close = authority.indexOf(']');
  if (close < 0 || authority.indexOf(']', close + 1) >= 0) {
    return false;
  }
  const literal = authority.slice(1, close);
  const suffix = authority.slice(close + 1);
  if (!literal || (suffix && (!suffix.startsWith(':') || !/^[0-9]*$/u.test(suffix.slice(1))))) {
    return false;
  }
  const zone = literal.indexOf('%');
  let address = literal;
  if (zone >= 0) {
    const zoneIdentifier = literal.slice(zone + 3);
    if (
      zone === 0
      || literal.slice(zone, zone + 3).toLowerCase() !== '%25'
      || !zoneIdentifier
      || !isGoCompatibleIPv6Zone(zoneIdentifier)
    ) {
      return false;
    }
    address = literal.slice(0, zone);
  }
  return isIPv6Address(address);
}

function isGoCompatibleIPv6Zone(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if (character === '%') {
      if (index + 2 >= value.length || !isHex(value[index + 1]) || !isHex(value[index + 2])) {
        return false;
      }
      const byte = Number.parseInt(value.slice(index + 1, index + 3), 16);
      if (byte !== 0x25 && byte !== 0x20 && !isGoCompatibleUnescapedHostByte(byte)) {
        return false;
      }
      index += 2;
      continue;
    }
    if (!isGoCompatibleUnescapedHostByte(character.charCodeAt(0))) {
      return false;
    }
  }
  return true;
}

// Mirrors the Go 1.26 net/url encodeHost table used for escaped zone bytes.
function isGoCompatibleUnescapedHostByte(value: number): boolean {
  return (value >= 0x30 && value <= 0x39)
    || (value >= 0x41 && value <= 0x5a)
    || (value >= 0x61 && value <= 0x7a)
    || `!"$&'()*+,-.:;<=>[]_~`.includes(String.fromCharCode(value));
}

function isIPv6Address(value: string): boolean {
  const compression = value.indexOf('::');
  if (compression !== value.lastIndexOf('::')) {
    return false;
  }
  const compressed = compression >= 0;
  const left = compressed ? value.slice(0, compression) : value;
  const right = compressed ? value.slice(compression + 2) : '';
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  if (leftGroups.some((group) => !group) || rightGroups.some((group) => !group)) {
    return false;
  }
  if (compressed && leftGroups.some((group) => group.includes('.'))) {
    return false;
  }
  const groups = [...leftGroups, ...rightGroups];
  let groupCount = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] as string;
    if (group.includes('.')) {
      if (index !== groups.length - 1 || !isIPv4Address(group)) {
        return false;
      }
      groupCount += 2;
      continue;
    }
    if (!/^[0-9A-Fa-f]{1,4}$/u.test(group)) {
      return false;
    }
    groupCount += 1;
  }
  return compressed ? groupCount < 8 : groupCount === 8;
}

function isIPv4Address(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => (
    /^(?:0|[1-9][0-9]{0,2})$/u.test(octet)
    && Number(octet) <= 255
  ));
}

function isSafeRefPass(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || /;base64,/iu.test(value) || isWindowsDrivePath(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  if (/\s/u.test(value)) {
    return false;
  }
  return !value.split('/').some((segment) => segment === '.' || segment === '..');
}

export function isNimiRuntimeAgentPresentationProfile(
  value: unknown,
): value is AgentPresentationProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  const revision = normalizeNimiRuntimeAgentPresentationRevision(profile.revision);
  if (revision === null || revision === '0') {
    return false;
  }
  return projectPersistedPresentationProfile(profile, revision) !== null;
}
