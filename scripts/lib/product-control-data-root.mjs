import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_PRODUCT_CONTROL_BYTES = 64 * 1024;
const USABLE_DATA_ROOT_STATUSES = new Set(['selected', 'ready']);
const PRODUCT_CONTROL_STATES = new Set([
  'not_logged_in',
  'config_missing',
  'data_root_missing',
  'data_root_selected',
  'repair_required',
  'blocked',
  'ready_for_use',
]);
const STATES_WITHOUT_USABLE_DATA_ROOT = new Set(['config_missing', 'data_root_missing']);
const STATES_REQUIRING_DATA_ROOT = new Set([
  'data_root_selected',
  'ready_for_use',
]);
const FAIL_CLOSED_PRODUCT_STATES = new Set(['blocked', 'repair_required']);
const PRODUCT_CONTROL_KEYS = Object.freeze([
  'schemaVersion',
  'installId',
  'productVersion',
  'state',
  'dataRoot',
  'firstRun',
  'pointers',
  'repair',
]);
const DATA_ROOT_KEYS = Object.freeze([
  'path',
  'status',
  'selectedAt',
  'verifiedAt',
  'selectedAtUnixMs',
  'verifiedAtUnixMs',
]);
const FIRST_RUN_KEYS = Object.freeze([
  'completed',
  'completedAt',
]);
const POINTER_KEYS = Object.freeze(['factoryProfileIndex']);
const REPAIR_KEYS = Object.freeze(['required', 'reason']);

export const NIMI_DATA_DIRECTORY_NAMES = Object.freeze([
  'models',
  'dependencies',
  'environments',
  'apps',
  'accounts',
  'logs',
  'audit',
]);

function comparablePath(value, platform) {
  const normalized = pathApiFor(platform).normalize(value);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function requireDirectProductControlBoundary(filePath, verifiedProfileDir, platform) {
  const pathApi = pathApiFor(platform);
  const controlDir = pathApi.dirname(filePath);
  const expectedControlDir = pathApi.join(
    normalizeVerifiedProfileDir(verifiedProfileDir, platform),
    '.nimi',
  );
  if (comparablePath(controlDir, platform) !== comparablePath(expectedControlDir, platform)
    || pathApi.basename(filePath) !== 'nimi.json') {
    throw new Error('Product Control locator escaped the fixed profile boundary');
  }

  const directoryMetadata = lstatSync(controlDir);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error('Product Control .nimi must be a direct directory');
  }
  const realProfile = realpathSync.native(verifiedProfileDir);
  const realControlDir = realpathSync.native(controlDir);
  if (comparablePath(realControlDir, platform)
    !== comparablePath(pathApi.join(realProfile, '.nimi'), platform)) {
    throw new Error('Product Control .nimi must not be redirected');
  }

  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Product Control must be a direct regular file');
  }
  const realFile = realpathSync.native(filePath);
  if (comparablePath(realFile, platform)
    !== comparablePath(pathApi.join(realControlDir, 'nimi.json'), platform)) {
    throw new Error('Product Control must not be redirected');
  }
  return metadata;
}

function readBoundedDirectFile(filePath, verifiedProfileDir, platform) {
  const metadata = requireDirectProductControlBoundary(filePath, verifiedProfileDir, platform);
  const handle = openSync(filePath, 'r');
  try {
    const openedMetadata = fstatSync(handle);
    if (!openedMetadata.isFile()
      || openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino) {
      throw new Error('Product Control changed while opening the direct regular file');
    }
    const buffer = Buffer.allocUnsafe(MAX_PRODUCT_CONTROL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(handle, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PRODUCT_CONTROL_BYTES) {
      throw new Error(`Product Control exceeds ${MAX_PRODUCT_CONTROL_BYTES} bytes`);
    }
    if (length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      throw new Error('Product Control must not contain a UTF-8 BOM');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    closeSync(handle);
  }
}

function pathApiFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function normalizeVerifiedProfileDir(value, platform) {
  const pathApi = pathApiFor(platform);
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('OS-verified interactive-user profile is unavailable');
  }
  const normalized = pathApi.normalize(value);
  if (!pathApi.isAbsolute(normalized) || normalized === pathApi.parse(normalized).root) {
    throw new Error('OS-verified interactive-user profile must be an absolute non-volume-root directory');
  }
  return normalized;
}

function currentOSVerifiedProfileDir() {
  let account;
  try {
    account = os.userInfo();
  } catch (error) {
    throw new Error('OS-verified interactive-user profile is unavailable', { cause: error });
  }
  return normalizeVerifiedProfileDir(account?.homedir, process.platform);
}

function productControlRecordPathFromVerifiedProfile(verifiedProfileDir, platform) {
  const pathApi = pathApiFor(platform);
  return pathApi.join(
    normalizeVerifiedProfileDir(verifiedProfileDir, platform),
    '.nimi',
    'nimi.json',
  );
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactObject(value, keys, label) {
  if (!isObject(value)) {
    throw new Error(`Product Control ${label} must be an object`);
  }
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.some((key) => !expected.has(key)) || keys.some((key) => !actual.includes(key))) {
    throw new Error(`Product Control ${label} fields are invalid`);
  }
  return value;
}

function requireNonEmptyText(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`Product Control ${label} must be non-empty text`);
  }
  return value;
}

function requireNullableNonEmptyText(value, label) {
  if (value === null) return null;
  return requireNonEmptyText(value, label);
}

function validateRecordShape(record, recordPath, platform) {
  requireExactObject(record, PRODUCT_CONTROL_KEYS, 'record');
  if (record.schemaVersion !== 1) {
    throw new Error(`Product Control schemaVersion must be 1 at ${recordPath}`);
  }
  requireNonEmptyText(record.installId, 'installId');
  requireNonEmptyText(record.productVersion, 'productVersion');
  const state = requireNonEmptyText(record.state, 'state');
  if (!PRODUCT_CONTROL_STATES.has(state)) {
    throw new Error(`Product Control state is invalid at ${recordPath}`);
  }

  let dataRoot = null;
  if (record.dataRoot !== null) {
    dataRoot = requireExactObject(record.dataRoot, DATA_ROOT_KEYS, 'dataRoot');
    normalizeAbsoluteNonVolumeRoot(dataRoot.path, platform);
    const status = requireNonEmptyText(dataRoot.status, 'dataRoot.status');
    if (!USABLE_DATA_ROOT_STATUSES.has(status) && status !== 'repair_required') {
      throw new Error(`Product Control dataRoot.status is invalid at ${recordPath}`);
    }
    requireNonEmptyText(dataRoot.selectedAt, 'dataRoot.selectedAt');
    requireNonEmptyText(dataRoot.verifiedAt, 'dataRoot.verifiedAt');
    if (!Number.isSafeInteger(dataRoot.selectedAtUnixMs) || dataRoot.selectedAtUnixMs < 0
      || !Number.isSafeInteger(dataRoot.verifiedAtUnixMs) || dataRoot.verifiedAtUnixMs < 0) {
      throw new Error('Product Control dataRoot verification timestamps are invalid');
    }
  }
  if (STATES_REQUIRING_DATA_ROOT.has(state) && dataRoot === null) {
    throw new Error(`Product Control state ${state} requires dataRoot`);
  }
  if (STATES_WITHOUT_USABLE_DATA_ROOT.has(state) && dataRoot !== null) {
    throw new Error(`Product Control state ${state} cannot carry dataRoot`);
  }

  const firstRun = requireExactObject(record.firstRun, FIRST_RUN_KEYS, 'firstRun');
  requireNullableNonEmptyText(firstRun.completedAt, 'firstRun.completedAt');
  if (typeof firstRun.completed !== 'boolean') {
    throw new Error('Product Control firstRun fields are invalid');
  }
  if (state !== 'ready_for_use' && (firstRun.completed || firstRun.completedAt !== null)) {
    throw new Error(`Product Control ${state} cannot carry completed firstRun`);
  }

  const pointers = requireExactObject(record.pointers, POINTER_KEYS, 'pointers');
  requireNullableNonEmptyText(pointers.factoryProfileIndex, 'pointers.factoryProfileIndex');
  const repair = requireExactObject(record.repair, REPAIR_KEYS, 'repair');
  if (typeof repair.required !== 'boolean') {
    throw new Error('Product Control repair.required must be boolean');
  }
  requireNullableNonEmptyText(repair.reason, 'repair.reason');
  if (FAIL_CLOSED_PRODUCT_STATES.has(state)) {
    if (!repair.required || repair.reason === null
      || (dataRoot !== null && dataRoot.status !== 'repair_required')) {
      throw new Error(`Product Control ${state} state/status/repair fields are inconsistent`);
    }
  } else if (repair.required || repair.reason !== null
    || (dataRoot !== null && dataRoot.status === 'repair_required')) {
    throw new Error(`Product Control ${state} state/status/repair fields are inconsistent`);
  }

  if (state === 'ready_for_use') {
    if (!firstRun.completed
      || dataRoot?.status !== 'ready'
      || typeof firstRun.completedAt !== 'string'
      || firstRun.completedAt.length === 0
    ) {
      throw new Error(`Product Control ready_for_use fields are invalid at ${recordPath}`);
    }
  }
}

function isAdmittedWindowsAbsolutePath(value) {
  if (/^[A-Za-z]:\\/u.test(value)) return true;
  const lower = value.toLocaleLowerCase('en-US');
  if (lower.startsWith('\\\\?\\unc\\')) {
    const parts = value.slice('\\\\?\\UNC\\'.length).split('\\');
    return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
  }
  if (lower.startsWith('\\\\?\\')) {
    return /^[A-Za-z]:\\/u.test(value.slice('\\\\?\\'.length));
  }
  if (!value.startsWith('\\\\')
    || lower.startsWith('\\\\.\\')
    || lower.startsWith('\\\\??\\')) {
    return false;
  }
  const parts = value.slice(2).split('\\');
  return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
}

function normalizeAbsoluteNonVolumeRoot(value, platform) {
  const pathApi = pathApiFor(platform);
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('Product Control dataRoot.path must be absolute');
  }
  const normalized = pathApi.normalize(value);
  if (platform === 'win32'
    ? !isAdmittedWindowsAbsolutePath(normalized)
    : !pathApi.isAbsolute(normalized)) {
    throw new Error('Product Control dataRoot.path must be absolute');
  }
  const isParsedVolumeRoot = comparablePath(normalized, platform)
    === comparablePath(pathApi.parse(normalized).root, platform);
  const isExtendedUNCShareRoot = platform === 'win32'
    && /^\\\\\?\\UNC\\[^\\/]+\\[^\\/]+\\?$/iu.test(normalized);
  if (isParsedVolumeRoot || isExtendedUNCShareRoot) {
    throw new Error('Product Control dataRoot.path must not be a volume root');
  }
  return normalized.replace(/[\\/]+$/u, '');
}

export function productControlRecordPath(...args) {
  if (args.length !== 0) {
    throw new Error('Production Product Control locator does not accept profile overrides');
  }
  return productControlRecordPathFromVerifiedProfile(
    currentOSVerifiedProfileDir(),
    process.platform,
  );
}

function resolveProductControlDataRootAtVerifiedProfile(verifiedProfileDir, platform) {
  const recordPath = productControlRecordPathFromVerifiedProfile(verifiedProfileDir, platform);
  let source;
  try {
    source = readBoundedDirectFile(recordPath, verifiedProfileDir, platform);
  } catch (error) {
    throw new Error(
      `Product Control is unavailable at ${recordPath}; complete or repair Product Control in Desktop`,
      { cause: error },
    );
  }

  let record;
  try {
    record = JSON.parse(source);
  } catch (error) {
    throw new Error(`Product Control is invalid at ${recordPath}`, { cause: error });
  }
  validateRecordShape(record, recordPath, platform);
  const { state } = record;
  if (FAIL_CLOSED_PRODUCT_STATES.has(state)
    || record.repair?.required === true) {
    throw new Error(`Product Control requires repair at ${recordPath}`);
  }
  if (STATES_WITHOUT_USABLE_DATA_ROOT.has(state)) {
    throw new Error(`Product Control has no selected data root at ${recordPath}`);
  }
  const status = record.dataRoot?.status;
  if (!USABLE_DATA_ROOT_STATUSES.has(status)) {
    throw new Error(`Product Control dataRoot.status must be selected or ready at ${recordPath}`);
  }
  if (state === 'ready_for_use' && status !== 'ready') {
    throw new Error(`Product Control ready_for_use requires dataRoot.status=ready at ${recordPath}`);
  }
  return normalizeAbsoluteNonVolumeRoot(record.dataRoot?.path, platform);
}

export function resolveProductControlDataRoot(...args) {
  if (args.length !== 0) {
    throw new Error('Production Product Control resolver does not accept locator overrides');
  }
  return resolveProductControlDataRootAtVerifiedProfile(
    currentOSVerifiedProfileDir(),
    process.platform,
  );
}

export function productControlRecordPathForTest({
  verifiedProfileDir,
  platform = process.platform,
} = {}) {
  return productControlRecordPathFromVerifiedProfile(verifiedProfileDir, platform);
}

export function resolveProductControlDataRootForTest({
  verifiedProfileDir,
  platform = process.platform,
} = {}) {
  return resolveProductControlDataRootAtVerifiedProfile(verifiedProfileDir, platform);
}

export function deriveNimiDataPaths(dataRoot, platform = process.platform) {
  const pathApi = pathApiFor(platform);
  const root = normalizeAbsoluteNonVolumeRoot(dataRoot, platform);
  return Object.freeze(Object.fromEntries([
    ['dataRoot', root],
    ...NIMI_DATA_DIRECTORY_NAMES.map((name) => [name, pathApi.join(root, name)]),
  ]));
}
