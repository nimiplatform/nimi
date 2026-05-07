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
    reason:
      | 'invalid-registration'
      | 'manifest-capability-shadow-truth';
  };

export type SideloadPreloadAdmission = {
  manifestCapabilities: string[];
  styleEntryPaths: string[];
};

export type SideloadPreloadAdmissionResult =
  | {
    admission: SideloadPreloadAdmission;
  }
  | {
    admission: null;
    reason: 'manifest-capabilities-missing';
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

function capabilityListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function createSideloadPreloadAdmission(input: {
  manifest: RuntimeLocalManifestSummaryLike;
}): SideloadPreloadAdmissionResult {
  const manifestCapabilities = extractManifestCapabilities(
    input.manifest.manifest as Record<string, unknown> | undefined,
  );
  if (manifestCapabilities.length === 0) {
    return {
      admission: null,
      reason: 'manifest-capabilities-missing',
    };
  }
  const styleEntryPaths = Array.isArray(input.manifest.stylePaths)
    ? input.manifest.stylePaths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
  return {
    admission: {
      manifestCapabilities,
      styleEntryPaths,
    },
  };
}

export function buildSideloadRuntimeModRegistration(input: {
  factory: RuntimeModFactory;
  manifest: RuntimeLocalManifestSummaryLike;
  admission: SideloadPreloadAdmission;
}): BuildSideloadRegistrationResult {
  const registration = input.factory();
  if (!registration?.modId) {
    return {
      registration: null,
      reason: 'invalid-registration',
    };
  }

  if (!Array.isArray(registration.capabilities)) {
    return {
      registration: null,
      reason: 'invalid-registration',
    };
  }
  const declaredCapabilities = normalizeCapabilityList(registration.capabilities);
  const normalizedManifestCapabilities = input.admission.manifestCapabilities;
  const factoryManifestCapabilities = normalizeCapabilityList(registration.manifestCapabilities);
  if (
    factoryManifestCapabilities.length > 0
    && !capabilityListsEqual(factoryManifestCapabilities, normalizedManifestCapabilities)
  ) {
    return {
      registration: null,
      reason: 'manifest-capability-shadow-truth',
    };
  }
  const normalizedCapabilities = declaredCapabilities.length > 0
    ? declaredCapabilities
    : normalizedManifestCapabilities;

  return {
    registration: {
      ...registration,
      capabilities: normalizedCapabilities,
      styleEntryPaths: input.admission.styleEntryPaths,
      sourceType: 'sideload',
      manifestCapabilities: normalizedManifestCapabilities,
    },
  };
}
