import {
  chmodSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const evidenceSchemaVersion = 'nimi.macos-dev-runtime-repair-failure/v1';
const safeDetailKeys = new Set([
  ...MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimePrincipalDiagnosticFields,
  'expected_projection_sha256',
  'observed_projection_sha256',
  'timeout_seconds',
  'sent_sigkill',
  'child_reaped',
]);

export function sanitizeRepairFailureDetails(details) {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const sanitized = {};
  for (const [key, value] of Object.entries(details)) {
    if (!safeDetailKeys.has(key)) continue;
    if (typeof value === 'boolean' || (Number.isSafeInteger(value) && Math.abs(value) <= 2 ** 31)) {
      sanitized[key] = value;
      continue;
    }
    if (typeof value === 'string' && value.length > 0 && value.length <= 256
      && !/[\r\n\0]/u.test(value)) {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

export function privilegedRepairFailurePermitsBootstrapCleanup(details) {
  return details?.child_reaped === true;
}

export function validateMacOSDevRepairSuccessReceipt(receipt) {
  const profile = MACOS_LOCAL_DEVELOPMENT_PROFILE;
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (!sameOrderedValues(Object.keys(receipt).sort(), [...profile.runtimeLegacyRepairSuccessReceiptRequiredFields].sort())) {
    return false;
  }
  const expectedRemoved = receipt.disposition === 'residue-removed'
    ? ['partial_launchd_definition', 'empty_install_directories', 'exact_runtime_principal']
    : null;
  if (expectedRemoved === null
    || receipt.schemaVersion !== profile.runtimeLegacyRepairSuccessReceiptSchemaVersion
    || receipt.status !== 'repaired'
    || receipt.serviceName !== profile.runtimeServiceLabel
    || !sameOrderedValues(receipt.removed, expectedRemoved)
    || !sameOrderedValues(receipt.preserved, profile.runtimeLegacyRepairSuccessReceiptPreservedFields)
    || receipt.sourceHelperDisposition
      !== profile.runtimeLegacyRepairSuccessReceiptSourceHelperDisposition
    || receipt.requiredInstallPrincipalCarrierContractVersion
      !== profile.runtimePrincipalCarrierContractVersion) {
    return false;
  }
  const sourceCarrier = receipt.sourcePrincipalCarrierContractVersion;
  if (![profile.runtimeNormalRepairSourcePrincipalCarrierContractVersion,
    profile.runtimeLegacyRepairSourcePrincipalCarrierContractVersion].includes(sourceCarrier)) {
    return false;
  }
  const rotationRequired = sourceCarrier !== profile.runtimePrincipalCarrierContractVersion;
  return receipt.trustHelperRotationRequired === rotationRequired
    && receipt.installReadiness === (rotationRequired
      ? 'trust-helper-rotation-required'
      : 'current-carrier-preserved')
    && receipt.nextPrivilegedAction === (rotationRequired
      ? profile.runtimeLegacyRepairSuccessReceiptStaleCarrierAction
      : profile.runtimeLegacyRepairSuccessReceiptCurrentCarrierAction);
}

export function writeMacOSDevRepairFailureEvidence({
  repoRoot,
  reasonCode,
  actionHint,
  message,
  details,
  sourceHelper,
  installedBootstrap,
  commandResult,
  cleanupDisposition,
  bootstrapPresentAfterCleanup,
  now = new Date(),
  pid = process.pid,
}) {
  const date = isoDate(now);
  const timestamp = now.toISOString().replaceAll(':', '').replaceAll('.', '-');
  const evidenceRoot = path.join(
    repoRoot,
    '.nimi',
    'local',
    'acceptance',
    `${date}-macos-runtime-desktop-zhiyu`,
  );
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const rootMetadata = lstatSync(evidenceRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
    || rootMetadata.uid !== process.getuid()) {
    throw new Error('unsafe macOS repair evidence directory metadata');
  }
  chmodSync(evidenceRoot, 0o700);
  if ((lstatSync(evidenceRoot).mode & 0o077) !== 0) {
    throw new Error('macOS repair evidence directory is not private');
  }

  const fileName = `privileged-repair-failure-${timestamp}-${pid}.json`;
  const finalPath = path.join(evidenceRoot, fileName);
  const stagingPath = `${finalPath}.staging`;
  const payload = {
    schemaVersion: evidenceSchemaVersion,
    status: 'failed',
    occurredAt: now.toISOString(),
    operation: 'repair-partial-runtime-install',
    retryPolicy: 'stop_after_single_privileged_failure',
    platform: process.platform,
    architecture: process.arch,
    reasonCode: boundedString(reasonCode, 128),
    actionHint: boundedString(actionHint, 256),
    message: boundedString(message, 2048),
    ...(sanitizeRepairFailureDetails(details) === undefined
      ? {}
      : { details: sanitizeRepairFailureDetails(details) }),
    sourceHelper: sanitizeFileIdentity(sourceHelper),
    installedBootstrap: sanitizeFileIdentity(installedBootstrap),
    subprocess: sanitizeCommandResult(commandResult),
    cleanup: {
      disposition: boundedString(cleanupDisposition || 'not-attempted', 512),
      bootstrapPresentAfterCleanup: Boolean(bootstrapPresentAfterCleanup),
    },
  };
  const data = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  if (data.length > 64 * 1024) throw new Error('macOS repair evidence exceeded its fixed budget');
  try {
    writeFileSync(stagingPath, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const staging = lstatSync(stagingPath);
    if (!staging.isFile() || staging.isSymbolicLink() || staging.uid !== process.getuid()
      || staging.nlink !== 1 || (staging.mode & 0o077) !== 0) {
      throw new Error('unsafe macOS repair evidence staging metadata');
    }
    renameSync(stagingPath, finalPath);
    chmodSync(finalPath, 0o600);
  } catch (error) {
    try { unlinkSync(stagingPath); } catch { /* exact staging may already be absent */ }
    throw error;
  }
  return path.relative(repoRoot, finalPath).replaceAll('\\', '/');
}

function sanitizeFileIdentity(value) {
  if (value === null || typeof value !== 'object') return null;
  const sha256 = typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.sha256)
    ? value.sha256
    : null;
  return {
    sha256,
    device: integerString(value.device),
    inode: integerString(value.inode),
  };
}

function sameOrderedValues(actual, expected) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function sanitizeCommandResult(value) {
  if (value === null || typeof value !== 'object') return null;
  return {
    status: Number.isSafeInteger(value.status) ? value.status : null,
    signal: typeof value.signal === 'string' && /^[A-Z0-9]{1,32}$/u.test(value.signal)
      ? value.signal
      : null,
    errorCode: typeof value.error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(value.error.code)
      ? value.error.code
      : null,
  };
}

function integerString(value) {
  if (typeof value === 'bigint' && value >= 0n) return value.toString(10);
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function boundedString(value, maximumLength) {
  const text = String(value || '').replace(/[\r\n\0]/gu, ' ').slice(0, maximumLength);
  return text || 'unavailable';
}

function isoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('invalid evidence time');
  return value.toISOString().slice(0, 10);
}
