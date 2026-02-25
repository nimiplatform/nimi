import type {
  RuntimeLocalManifestSummaryLike,
  RuntimeModFactory,
  RuntimeModRegistration,
} from '../../types';
import { extractManifestCapabilities } from '../manifest-capabilities';

export type BuildSideloadRegistrationResult =
  | {
    registration: RuntimeModRegistration;
  }
  | {
    registration: null;
    reason: 'invalid-registration';
  };

function normalizeCapabilityList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

export function buildSideloadRuntimeModRegistration(input: {
  factory: RuntimeModFactory;
  manifest: RuntimeLocalManifestSummaryLike;
}): BuildSideloadRegistrationResult {
  const registration = input.factory();
  if (!registration?.modId) {
    return {
      registration: null,
      reason: 'invalid-registration',
    };
  }

  const manifestCapabilities = extractManifestCapabilities(
    input.manifest.manifest as Record<string, unknown> | undefined,
  );
  if (!Array.isArray(registration.capabilities)) {
    return {
      registration: null,
      reason: 'invalid-registration',
    };
  }
  const declaredCapabilities = normalizeCapabilityList(registration.capabilities);
  const normalizedManifestCapabilities = manifestCapabilities.length > 0
    ? manifestCapabilities
    : normalizeCapabilityList(registration.manifestCapabilities);
  const normalizedCapabilities = declaredCapabilities.length > 0
    ? declaredCapabilities
    : normalizedManifestCapabilities;

  return {
    registration: {
      ...registration,
      capabilities: normalizedCapabilities,
      sourceType: 'sideload',
      manifestCapabilities: normalizedManifestCapabilities,
    },
  };
}
