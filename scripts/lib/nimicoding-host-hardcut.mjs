import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

const MANIFEST_RELATIVE_PATH = 'config/nimicoding-host-hardcut.yaml';
const PACKAGE_JSON_RELATIVE_PATH = 'package.json';
const ALLOWED_SYNC_STATUSES = new Set([
  'in_sync',
  'drifted_preserved',
  'missing_host_state_seed',
  'missing_package_canonical',
  'drifted_package_canonical',
]);
const CHECK_FAILURE_STATUSES = new Set([
  'missing_host_state_seed',
  'missing_package_canonical',
  'drifted_package_canonical',
]);
const YAML_ASSERTION_OPERATORS = new Set([
  'equals',
  'set_equals',
  'map_key_set_equals',
]);

function normalizeRelativePath(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} entries must be non-empty strings`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${field} must contain project-relative paths: ${value}`);
  }
  return normalized.replace(/^\.\//u, '');
}

function normalizeUniquePathList(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  const normalized = value.map((entry) => normalizeRelativePath(entry, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} must not contain duplicate paths`);
  }
  return normalized;
}

function requireStringList(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${field} must not contain duplicates`);
  }
  return value;
}

function normalizeDoctorErrorChecks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('old_doctor_compatibility.allowed_error_checks must be a non-empty array');
  }
  const normalized = value.map((entry) => {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || typeof entry.id !== 'string'
      || entry.id.length === 0
      || typeof entry.detail !== 'string'
      || entry.detail.length === 0
    ) {
      throw new Error('old_doctor_compatibility.allowed_error_checks entries require non-empty id and detail');
    }
    return { id: entry.id, detail: entry.detail };
  });
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) {
    throw new Error('old_doctor_compatibility.allowed_error_checks must not contain duplicate ids');
  }
  return normalized;
}

function normalizeYamlAssertions(value, overridePaths) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.yaml_assertions) || value.yaml_assertions.length === 0) {
    throw new Error('host_projection_semantics.yaml_assertions must be a non-empty array');
  }
  const overrideSet = new Set(overridePaths);
  const seenPaths = new Set();
  return {
    yaml_assertions: value.yaml_assertions.map((entry) => {
      const relativePath = normalizeRelativePath(entry?.path, 'host_projection_semantics.yaml_assertions.path');
      if (!overrideSet.has(relativePath)) {
        throw new Error(`semantic assertion path is not a declared host override: ${relativePath}`);
      }
      if (seenPaths.has(relativePath)) {
        throw new Error(`duplicate semantic assertion path: ${relativePath}`);
      }
      seenPaths.add(relativePath);
      if (!Array.isArray(entry.assertions) || entry.assertions.length === 0) {
        throw new Error(`semantic assertion path requires assertions: ${relativePath}`);
      }
      const seenPointers = new Set();
      const assertions = entry.assertions.map((assertion) => {
        if (
          !assertion
          || typeof assertion !== 'object'
          || typeof assertion.pointer !== 'string'
          || assertion.pointer.length === 0
          || !YAML_ASSERTION_OPERATORS.has(assertion.operator)
          || !Object.hasOwn(assertion, 'value')
        ) {
          throw new Error(`invalid semantic assertion in ${relativePath}`);
        }
        if (seenPointers.has(assertion.pointer)) {
          throw new Error(`duplicate semantic assertion pointer in ${relativePath}: ${assertion.pointer}`);
        }
        seenPointers.add(assertion.pointer);
        if (
          (assertion.operator === 'set_equals' || assertion.operator === 'map_key_set_equals')
          && (!Array.isArray(assertion.value) || assertion.value.some((item) => !['string', 'number', 'boolean'].includes(typeof item)))
        ) {
          throw new Error(`${assertion.operator} requires a primitive value array in ${relativePath}: ${assertion.pointer}`);
        }
        if (
          assertion.operator === 'map_key_set_equals'
          && (typeof assertion.key !== 'string' || assertion.key.length === 0)
        ) {
          throw new Error(`map_key_set_equals requires key in ${relativePath}: ${assertion.pointer}`);
        }
        return {
          pointer: assertion.pointer,
          operator: assertion.operator,
          ...(assertion.operator === 'map_key_set_equals' ? { key: assertion.key } : {}),
          value: assertion.value,
        };
      });
      return { path: relativePath, assertions };
    }),
  };
}

export function validateHostHardcutManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('nimicoding host hardcut manifest must be an object');
  }
  if (input.version !== 1 || input.policy_id !== 'nimi.nimicoding-host-workflow-hardcut.v1') {
    throw new Error('unsupported nimicoding host hardcut manifest identity');
  }

  const forbiddenPaths = normalizeUniquePathList(
    input.forbidden_package_projection_paths,
    'forbidden_package_projection_paths',
  );
  const overridePaths = normalizeUniquePathList(
    input.host_override_projection_paths,
    'host_override_projection_paths',
  );
  const overlap = forbiddenPaths.filter((entry) => overridePaths.includes(entry));
  if (overlap.length > 0) {
    throw new Error(`forbidden and override projection paths overlap: ${overlap.join(', ')}`);
  }

  const authorityPath = normalizeRelativePath(input.authority?.path, 'authority.path');
  const requiredRuleIds = requireStringList(input.authority?.required_rule_ids, 'authority.required_rule_ids');
  const packageName = input.package_compatibility?.package_name;
  if (packageName !== '@nimiplatform/nimi-coding') {
    throw new Error('package_compatibility.package_name must be @nimiplatform/nimi-coding');
  }
  const allowedVersions = requireStringList(
    input.package_compatibility?.allowed_versions,
    'package_compatibility.allowed_versions',
  );

  const hostProjectionSemantics = normalizeYamlAssertions(
    input.host_projection_semantics,
    overridePaths,
  );

  const doctorErrorChecks = normalizeDoctorErrorChecks(
    input.old_doctor_compatibility?.allowed_error_checks,
  );
  const doctorInvalidContractPaths = normalizeUniquePathList(
    input.old_doctor_compatibility?.allowed_invalid_contract_paths,
    'old_doctor_compatibility.allowed_invalid_contract_paths',
  );

  const scanRoots = normalizeUniquePathList(input.entrypoint_scan?.roots, 'entrypoint_scan.roots');
  const includedExtensions = requireStringList(
    input.entrypoint_scan?.included_extensions,
    'entrypoint_scan.included_extensions',
  );
  const excludedPathSuffixes = requireStringList(
    input.entrypoint_scan?.excluded_path_suffixes,
    'entrypoint_scan.excluded_path_suffixes',
  );
  const excludedPathSegments = requireStringList(
    input.entrypoint_scan?.excluded_path_segments,
    'entrypoint_scan.excluded_path_segments',
  );
  const forbiddenSubstrings = requireStringList(
    input.entrypoint_scan?.forbidden_substrings,
    'entrypoint_scan.forbidden_substrings',
  );
  if (forbiddenSubstrings.some((entry) => entry !== entry.toLowerCase())) {
    throw new Error('entrypoint_scan.forbidden_substrings must be lowercase');
  }

  const scriptContract = input.package_script_contract;
  if (!scriptContract || typeof scriptContract !== 'object' || Array.isArray(scriptContract)) {
    throw new Error('package_script_contract must be an object');
  }
  for (const [scriptName, command] of Object.entries(scriptContract)) {
    if (!scriptName || typeof command !== 'string' || command.length === 0) {
      throw new Error('package_script_contract entries must map script names to non-empty commands');
    }
  }

  return {
    ...input,
    authority: { path: authorityPath, required_rule_ids: requiredRuleIds },
    package_compatibility: { package_name: packageName, allowed_versions: allowedVersions },
    forbidden_package_projection_paths: forbiddenPaths,
    host_override_projection_paths: overridePaths,
    host_projection_semantics: hostProjectionSemantics,
    old_doctor_compatibility: {
      allowed_error_checks: doctorErrorChecks,
      allowed_invalid_contract_paths: doctorInvalidContractPaths,
    },
    entrypoint_scan: {
      roots: scanRoots,
      included_extensions: includedExtensions,
      excluded_path_suffixes: excludedPathSuffixes,
      excluded_path_segments: excludedPathSegments,
      forbidden_substrings: forbiddenSubstrings,
    },
    package_script_contract: { ...scriptContract },
  };
}

function readYamlPointer(document, pointer) {
  let value = document;
  for (const segment of pointer.split('.')) {
    if (Array.isArray(value) && /^\d+$/u.test(segment)) {
      value = value[Number(segment)];
      continue;
    }
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      return { found: false, value: undefined };
    }
    value = value[segment];
  }
  return { found: true, value };
}

function sortedPrimitiveSet(value) {
  if (!Array.isArray(value) || value.some((item) => !['string', 'number', 'boolean'].includes(typeof item))) {
    return null;
  }
  return [...new Set(value)].sort((left, right) => String(left).localeCompare(String(right)));
}

function evaluateYamlAssertion(document, assertion) {
  const actual = readYamlPointer(document, assertion.pointer);
  if (!actual.found) {
    return `missing YAML pointer ${assertion.pointer}`;
  }
  if (assertion.operator === 'equals') {
    return JSON.stringify(actual.value) === JSON.stringify(assertion.value)
      ? null
      : `expected ${assertion.pointer}=${JSON.stringify(assertion.value)}, found ${JSON.stringify(actual.value)}`;
  }
  if (assertion.operator === 'set_equals') {
    const actualSet = sortedPrimitiveSet(actual.value);
    const expectedSet = sortedPrimitiveSet(assertion.value);
    return actualSet && JSON.stringify(actualSet) === JSON.stringify(expectedSet)
      ? null
      : `expected ${assertion.pointer} set ${JSON.stringify(expectedSet)}, found ${JSON.stringify(actual.value)}`;
  }
  if (!Array.isArray(actual.value)) {
    return `expected ${assertion.pointer} to be an object array`;
  }
  const mapped = actual.value.map((entry) => (
    entry && typeof entry === 'object' ? entry[assertion.key] : undefined
  ));
  const actualSet = sortedPrimitiveSet(mapped);
  const expectedSet = sortedPrimitiveSet(assertion.value);
  return actualSet && JSON.stringify(actualSet) === JSON.stringify(expectedSet)
    ? null
    : `expected ${assertion.pointer} mapped by ${assertion.key} to ${JSON.stringify(expectedSet)}, found ${JSON.stringify(mapped)}`;
}

export async function loadHostHardcutManifest(projectRoot) {
  const manifestPath = path.join(projectRoot, ...MANIFEST_RELATIVE_PATH.split('/'));
  const text = await readFile(manifestPath, 'utf8');
  return validateHostHardcutManifest(YAML.parse(text));
}

async function pathKind(absolutePath) {
  try {
    const info = await lstat(absolutePath);
    return info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}

function shouldScanPath(relativePath, scan) {
  const segments = relativePath.split('/');
  if (segments.some((segment) => scan.excluded_path_segments.includes(segment))) {
    return false;
  }
  if (scan.excluded_path_suffixes.some((suffix) => relativePath.endsWith(suffix))) {
    return false;
  }
  return scan.included_extensions.includes(path.posix.extname(relativePath));
}

async function collectScanFiles(projectRoot, relativeRoot, scan) {
  const absoluteRoot = path.join(projectRoot, ...relativeRoot.split('/'));
  const kind = await pathKind(absoluteRoot);
  if (kind === 'missing') {
    throw new Error(`entrypoint scan root is missing: ${relativeRoot}`);
  }
  if (kind === 'file') {
    // An explicitly declared file root is an entrypoint even when it has no
    // extension (for example `.cursorrules`). Directory walks remain filtered
    // by included_extensions.
    return [relativeRoot];
  }
  if (kind !== 'directory') {
    throw new Error(`entrypoint scan root is not a file or directory: ${relativeRoot}`);
  }

  const files = [];
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!scan.excluded_path_segments.includes(entry.name)) {
        files.push(...await collectScanFiles(projectRoot, relativePath, scan));
      }
      continue;
    }
    if (entry.isFile() && shouldScanPath(relativePath, scan)) {
      files.push(relativePath);
    }
  }
  return files;
}

export async function inspectHostHardcut(projectRoot, manifest) {
  const failures = [];
  for (const relativePath of manifest.forbidden_package_projection_paths) {
    const kind = await pathKind(path.join(projectRoot, ...relativePath.split('/')));
    if (kind !== 'missing') {
      failures.push(`forbidden package workflow projection is present (${kind}): ${relativePath}`);
    }
  }
  for (const relativePath of manifest.host_override_projection_paths) {
    const kind = await pathKind(path.join(projectRoot, ...relativePath.split('/')));
    if (kind !== 'file') {
      failures.push(`required host override projection is ${kind}: ${relativePath}`);
    }
  }
  for (const semanticContract of manifest.host_projection_semantics.yaml_assertions) {
    const absolutePath = path.join(projectRoot, ...semanticContract.path.split('/'));
    if (await pathKind(absolutePath) !== 'file') {
      continue;
    }
    const document = YAML.parse(await readFile(absolutePath, 'utf8'));
    for (const assertion of semanticContract.assertions) {
      const failure = evaluateYamlAssertion(document, assertion);
      if (failure) {
        failures.push(`host projection semantic drift in ${semanticContract.path}: ${failure}`);
      }
    }
  }

  const authorityText = await readFile(
    path.join(projectRoot, ...manifest.authority.path.split('/')),
    'utf8',
  );
  for (const ruleId of manifest.authority.required_rule_ids) {
    if (!authorityText.includes(ruleId)) {
      failures.push(`host workflow authority is missing rule ${ruleId}: ${manifest.authority.path}`);
    }
  }

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, PACKAGE_JSON_RELATIVE_PATH), 'utf8'));
  for (const [scriptName, expectedCommand] of Object.entries(manifest.package_script_contract)) {
    const actualCommand = packageJson.scripts?.[scriptName];
    if (actualCommand !== expectedCommand) {
      failures.push(
        `package script ${scriptName} must be exactly ${JSON.stringify(expectedCommand)}; found ${JSON.stringify(actualCommand)}`,
      );
    }
  }

  const scanFiles = [];
  for (const relativeRoot of manifest.entrypoint_scan.roots) {
    scanFiles.push(...await collectScanFiles(projectRoot, relativeRoot, manifest.entrypoint_scan));
  }
  for (const relativePath of [...new Set(scanFiles)].sort()) {
    const text = (await readFile(path.join(projectRoot, ...relativePath.split('/')), 'utf8')).toLowerCase();
    for (const forbiddenSubstring of manifest.entrypoint_scan.forbidden_substrings) {
      if (text.includes(forbiddenSubstring)) {
        failures.push(`retired package workflow entrypoint ${JSON.stringify(forbiddenSubstring)} found in ${relativePath}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    scannedFiles: [...new Set(scanFiles)].sort(),
    forbiddenProjectionCount: manifest.forbidden_package_projection_paths.length,
    hostOverrideCount: manifest.host_override_projection_paths.length,
    semanticAssertionCount: manifest.host_projection_semantics.yaml_assertions
      .reduce((total, entry) => total + entry.assertions.length, 0),
  };
}

function validateSyncReportShape(report) {
  if (!report || typeof report !== 'object' || report.mode !== 'check' || !Array.isArray(report.results)) {
    throw new Error('nimicoding sync returned an unsupported report shape');
  }
  const seenPaths = new Set();
  for (const entry of report.results) {
    const relativePath = normalizeRelativePath(entry?.outputRelativePath, 'sync results outputRelativePath');
    if (seenPaths.has(relativePath)) {
      throw new Error(`nimicoding sync returned duplicate result path: ${relativePath}`);
    }
    seenPaths.add(relativePath);
    if (typeof entry.ownership !== 'string' || !ALLOWED_SYNC_STATUSES.has(entry.status)) {
      throw new Error(`nimicoding sync returned unsupported result for ${relativePath}`);
    }
  }
  if (!report.summary || report.summary.total !== report.results.length) {
    throw new Error('nimicoding sync summary total does not match results');
  }
  for (const status of ALLOWED_SYNC_STATUSES) {
    const expectedCount = report.results.filter((entry) => entry.status === status).length;
    if (report.summary[status] !== expectedCount) {
      throw new Error(`nimicoding sync summary ${status} does not match results`);
    }
  }
  if (!Array.isArray(report.checkFailures)) {
    throw new Error('nimicoding sync report is missing checkFailures');
  }
  const expectedFailureKeys = report.results
    .filter((entry) => CHECK_FAILURE_STATUSES.has(entry.status))
    .map((entry) => `${entry.outputRelativePath}\0${entry.status}`)
    .sort();
  const actualFailureKeys = report.checkFailures
    .map((entry) => `${normalizeRelativePath(entry?.outputRelativePath, 'sync checkFailures outputRelativePath')}\0${entry.status}`)
    .sort();
  if (JSON.stringify(expectedFailureKeys) !== JSON.stringify(actualFailureKeys)) {
    throw new Error('nimicoding sync checkFailures do not match result failure statuses');
  }
  if (report.ok !== (report.checkFailures.length === 0)) {
    throw new Error('nimicoding sync report ok does not match checkFailures');
  }
}

export function evaluateSyncCompatibility(report, manifest) {
  validateSyncReportShape(report);
  const forbiddenPaths = new Set(manifest.forbidden_package_projection_paths);
  const overridePaths = new Set(manifest.host_override_projection_paths);
  const failures = [];
  const tolerated = [];
  const resultByPath = new Map(
    report.results.map((entry) => [
      normalizeRelativePath(entry.outputRelativePath, 'sync result outputRelativePath'),
      entry,
    ]),
  );

  for (const relativePath of forbiddenPaths) {
    const entry = resultByPath.get(relativePath);
    if (!entry) {
      failures.push(`nimicoding sync omitted forbidden projection path: ${relativePath}`);
      continue;
    }
    if (entry.status !== 'missing_package_canonical') {
      failures.push(`forbidden projection must be missing_package_canonical, found ${entry.status}: ${relativePath}`);
    }
  }
  for (const relativePath of overridePaths) {
    const entry = resultByPath.get(relativePath);
    if (!entry) {
      failures.push(`nimicoding sync omitted host override projection path: ${relativePath}`);
      continue;
    }
    if (!['in_sync', 'drifted_package_canonical', 'drifted_preserved'].includes(entry.status)) {
      failures.push(`host override projection has unsupported status ${entry.status}: ${relativePath}`);
    }
  }

  for (const entry of report.results) {
    const relativePath = normalizeRelativePath(entry.outputRelativePath, 'sync result outputRelativePath');
    if (entry.status === 'in_sync') {
      continue;
    }
    if (entry.status === 'missing_package_canonical' && forbiddenPaths.has(relativePath)) {
      tolerated.push({ path: relativePath, status: entry.status });
      continue;
    }
    if (
      (entry.status === 'drifted_package_canonical' || entry.status === 'drifted_preserved')
      && overridePaths.has(relativePath)
    ) {
      tolerated.push({ path: relativePath, status: entry.status });
      continue;
    }
    failures.push(`unadmitted nimi-coding seed status ${entry.status}: ${relativePath}`);
  }

  return { ok: failures.length === 0, failures, tolerated };
}

export function evaluateDoctorCompatibility(report, manifest, expectedProjectRoot) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.checks)) {
    throw new Error('nimicoding doctor returned an unsupported report shape');
  }
  if (report.bootstrapPresent !== true) {
    throw new Error('nimicoding doctor did not find the project bootstrap');
  }
  if (path.resolve(report.projectRoot) !== path.resolve(expectedProjectRoot)) {
    throw new Error(`nimicoding doctor inspected an unexpected project root: ${report.projectRoot}`);
  }

  const expectedErrorChecks = new Map(
    manifest.old_doctor_compatibility.allowed_error_checks.map((entry) => [entry.id, entry.detail]),
  );
  const failures = [];
  const toleratedCheckIds = [];
  const seenCheckIds = new Set();
  const seenErrorCheckIds = new Set();
  for (const check of report.checks) {
    if (!check || typeof check.id !== 'string' || typeof check.ok !== 'boolean') {
      throw new Error('nimicoding doctor returned a malformed check entry');
    }
    if (seenCheckIds.has(check.id)) {
      throw new Error(`nimicoding doctor returned duplicate check id: ${check.id}`);
    }
    seenCheckIds.add(check.id);
    const isError = !check.ok || check.severity === 'error';
    if (!isError) {
      continue;
    }
    seenErrorCheckIds.add(check.id);
    const expectedDetail = expectedErrorChecks.get(check.id);
    if (expectedDetail !== undefined) {
      if (check.ok !== false || check.severity !== 'error') {
        failures.push(`expected nimi-coding doctor error ${check.id} must have ok=false and severity=error`);
      } else if (check.detail !== expectedDetail) {
        failures.push(
          `nimi-coding doctor detail changed for ${check.id}: expected ${JSON.stringify(expectedDetail)}, found ${JSON.stringify(check.detail)}`,
        );
      } else {
        toleratedCheckIds.push(check.id);
      }
      continue;
    }
    failures.push(`unadmitted nimi-coding doctor failure ${check.id}: ${check.detail ?? 'no detail'}`);
  }
  for (const checkId of expectedErrorChecks.keys()) {
    if (!seenErrorCheckIds.has(checkId)) {
      failures.push(`nimi-coding doctor omitted expected compatibility error: ${checkId}`);
    }
  }
  if (report.ok !== false) {
    failures.push('nimi-coding doctor report must remain not-ok while declared 0.2.7 compatibility errors are present');
  }

  const invalidContracts = report.executionContracts?.invalid;
  if (!Array.isArray(invalidContracts)) {
    throw new Error('nimicoding doctor report is missing executionContracts.invalid');
  }
  const normalizedInvalidContracts = invalidContracts
    .map((entry) => normalizeRelativePath(entry, 'doctor executionContracts.invalid'))
    .sort();
  const expectedInvalidContracts = [...manifest.old_doctor_compatibility.allowed_invalid_contract_paths].sort();
  if (
    new Set(normalizedInvalidContracts).size !== normalizedInvalidContracts.length
    || JSON.stringify(normalizedInvalidContracts) !== JSON.stringify(expectedInvalidContracts)
  ) {
    failures.push(
      `nimi-coding doctor invalid execution contracts changed: expected ${expectedInvalidContracts.join(', ')}, found ${normalizedInvalidContracts.join(', ')}`,
    );
  }

  if (report.adapterProfiles?.selected !== null) {
    failures.push('nimi-coding doctor must report adapterProfiles.selected=null');
  }
  if (report.delegatedContracts?.selectedAdapterId !== 'none') {
    failures.push('nimi-coding doctor must report delegatedContracts.selectedAdapterId=none');
  }
  if (report.runtimeInstalled !== false) {
    failures.push('nimi-coding doctor must report runtimeInstalled=false');
  }

  return {
    ok: failures.length === 0,
    failures,
    toleratedCheckIds: toleratedCheckIds.sort(),
    toleratedInvalidContracts: normalizedInvalidContracts,
  };
}

export function assertCompatiblePackageVersion(packageJson, manifest) {
  if (packageJson?.name !== manifest.package_compatibility.package_name) {
    throw new Error(`unexpected nimi-coding package identity: ${packageJson?.name ?? 'missing'}`);
  }
  if (!manifest.package_compatibility.allowed_versions.includes(packageJson.version)) {
    throw new Error(
      `unverified nimi-coding package version ${packageJson.version ?? 'missing'}; update and verify the host hardcut manifest first`,
    );
  }
}

export const HOST_HARDCUT_MANIFEST_PATH = MANIFEST_RELATIVE_PATH;
