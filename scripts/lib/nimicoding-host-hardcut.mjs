import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

const MANIFEST_RELATIVE_PATH = 'config/nimicoding-host-hardcut.yaml';
const PACKAGE_JSON_RELATIVE_PATH = 'package.json';
const LOCKFILE_RELATIVE_PATH = 'pnpm-lock.yaml';

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizeRelativePath(value, field) {
  const normalized = requireString(value, field).replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    path.posix.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
  ) {
    throw new Error(`${field} must contain project-relative paths: ${value}`);
  }
  return normalized.replace(/\/$/u, '');
}

function normalizeUniqueList(value, field, normalize = (entry) => requireString(entry, field)) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }
  const result = value.map(normalize);
  if (new Set(result).size !== result.length) {
    throw new Error(`${field} must not contain duplicates`);
  }
  return result;
}

function normalizePathList(value, field) {
  return normalizeUniqueList(value, field, (entry) => normalizeRelativePath(entry, field));
}

function normalizeScriptContract(value) {
  const input = requireObject(value, 'required_package_scripts');
  const entries = Object.entries(input);
  if (entries.length === 0) {
    throw new Error('required_package_scripts must not be empty');
  }
  for (const [scriptName, command] of entries) {
    requireString(scriptName, 'required_package_scripts key');
    requireString(command, `required_package_scripts.${scriptName}`);
  }
  return Object.fromEntries(entries);
}

function pathIsInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function validateHostHardcutManifest(input) {
  requireObject(input, 'nimicoding host hardcut manifest');
  if (input.version !== 2 || input.policy_id !== 'nimi.nimicoding-host-boundary-hardcut.v2') {
    throw new Error('unsupported nimicoding host hardcut manifest identity');
  }

  const authority = requireObject(input.authority, 'authority');
  const authorityPath = normalizeRelativePath(authority.path, 'authority.path');
  const requiredRuleIds = normalizeUniqueList(authority.required_rule_ids, 'authority.required_rule_ids');

  const packageContract = requireObject(input.package, 'package');
  const packageName = requireString(packageContract.name, 'package.name');
  if (packageName !== '@nimiplatform/nimi-coding') {
    throw new Error('package.name must be @nimiplatform/nimi-coding');
  }
  const requiredVersion = requireString(packageContract.required_version, 'package.required_version');
  const requiredDependencyRange = requireString(
    packageContract.required_dependency_range,
    'package.required_dependency_range',
  );

  const retiredPaths = normalizePathList(
    input.retired_active_projection_paths,
    'retired_active_projection_paths',
  );
  const historicalRoots = normalizePathList(input.preserved_historical_roots, 'preserved_historical_roots');
  for (const historicalRoot of historicalRoots) {
    const overlap = retiredPaths.find((candidate) => pathIsInside(historicalRoot, candidate));
    if (overlap) {
      throw new Error(`retired projection list crosses preserved historical root ${historicalRoot}: ${overlap}`);
    }
  }

  const forbiddenInstalledPaths = normalizePathList(
    input.forbidden_installed_package_paths,
    'forbidden_installed_package_paths',
  );

  const scanInput = requireObject(input.entrypoint_scan, 'entrypoint_scan');
  const scanRoots = normalizePathList(scanInput.roots, 'entrypoint_scan.roots');
  for (const historicalRoot of historicalRoots) {
    if (scanRoots.some((root) => pathIsInside(root, historicalRoot) || pathIsInside(historicalRoot, root))) {
      throw new Error(`entrypoint scan must not cross preserved historical root: ${historicalRoot}`);
    }
  }
  const includedExtensions = normalizeUniqueList(
    scanInput.included_extensions,
    'entrypoint_scan.included_extensions',
  );
  if (includedExtensions.some((extension) => !extension.startsWith('.'))) {
    throw new Error('entrypoint_scan.included_extensions entries must start with a dot');
  }
  const excludedPathSegments = normalizeUniqueList(
    scanInput.excluded_path_segments,
    'entrypoint_scan.excluded_path_segments',
  );
  if (excludedPathSegments.some((segment) => segment.includes('/'))) {
    throw new Error('entrypoint_scan.excluded_path_segments entries must be single path segments');
  }
  const forbiddenSubstrings = normalizeUniqueList(
    scanInput.forbidden_substrings,
    'entrypoint_scan.forbidden_substrings',
  );
  if (forbiddenSubstrings.some((entry) => entry !== entry.toLowerCase())) {
    throw new Error('entrypoint_scan.forbidden_substrings entries must be lowercase');
  }

  const requiredPackageScripts = normalizeScriptContract(input.required_package_scripts);
  const forbiddenPackageScripts = normalizeUniqueList(
    input.forbidden_package_scripts,
    'forbidden_package_scripts',
  );
  const scriptOverlap = forbiddenPackageScripts.filter((name) => Object.hasOwn(requiredPackageScripts, name));
  if (scriptOverlap.length > 0) {
    throw new Error(`required and forbidden package scripts overlap: ${scriptOverlap.join(', ')}`);
  }

  return {
    version: input.version,
    policy_id: input.policy_id,
    authority: {
      path: authorityPath,
      required_rule_ids: requiredRuleIds,
    },
    package: {
      name: packageName,
      required_version: requiredVersion,
      required_dependency_range: requiredDependencyRange,
    },
    retired_active_projection_paths: retiredPaths,
    preserved_historical_roots: historicalRoots,
    forbidden_installed_package_paths: forbiddenInstalledPaths,
    entrypoint_scan: {
      roots: scanRoots,
      included_extensions: includedExtensions,
      excluded_path_segments: excludedPathSegments,
      forbidden_substrings: forbiddenSubstrings,
    },
    required_package_scripts: requiredPackageScripts,
    forbidden_package_scripts: forbiddenPackageScripts,
  };
}

export async function loadHostHardcutManifest(projectRoot) {
  const manifestPath = path.join(projectRoot, ...MANIFEST_RELATIVE_PATH.split('/'));
  const source = await readFile(manifestPath, 'utf8');
  return validateHostHardcutManifest(YAML.parse(source));
}

async function pathKind(absolutePath) {
  try {
    const info = await lstat(absolutePath);
    if (info.isFile()) return 'file';
    if (info.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function collectScanFiles(projectRoot, relativeRoot, scan) {
  const absoluteRoot = path.join(projectRoot, ...relativeRoot.split('/'));
  const kind = await pathKind(absoluteRoot);
  if (kind === 'missing') {
    throw new Error(`entrypoint scan root is missing: ${relativeRoot}`);
  }
  if (kind === 'file') return [relativeRoot];
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
    if (entry.isFile() && scan.included_extensions.includes(path.posix.extname(relativePath))) {
      files.push(relativePath);
    }
  }
  return files;
}

async function readJsonFile(absolutePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return requireObject(parsed, label);
}

async function readYamlFile(absolutePath, label) {
  let parsed;
  try {
    parsed = YAML.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid YAML: ${error.message}`);
  }
  return requireObject(parsed, label);
}

function normalizedLockVersion(value) {
  const raw = typeof value === 'object' && value !== null ? value.version : value;
  return typeof raw === 'string' ? raw.split('(')[0] : '';
}

function inspectWorkspaceLockfile(lockfile, packageContract, failures) {
  const allowedSpecifiers = new Set([
    packageContract.required_dependency_range,
    packageContract.required_version,
  ]);
  let workspaceConsumerCount = 0;

  for (const [importerId, importer] of Object.entries(lockfile.importers ?? {})) {
    for (const dependencyGroup of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const declaration = importer?.[dependencyGroup]?.[packageContract.name];
      if (declaration === undefined) continue;
      workspaceConsumerCount += 1;
      const specifier = typeof declaration === 'object' && declaration !== null
        ? String(declaration.specifier ?? '')
        : String(declaration);
      const resolvedVersion = normalizedLockVersion(declaration);
      if (!allowedSpecifiers.has(specifier)) {
        failures.push(
          `workspace importer ${importerId} declares ${packageContract.name} with unsupported specifier ${JSON.stringify(specifier)}`,
        );
      }
      if (resolvedVersion !== packageContract.required_version) {
        failures.push(
          `workspace importer ${importerId} resolves ${packageContract.name} to ${JSON.stringify(resolvedVersion || null)} instead of ${packageContract.required_version}`,
        );
      }
    }
  }

  const resolvedKeys = new Set();
  for (const section of ['packages', 'snapshots']) {
    for (const key of Object.keys(lockfile[section] ?? {})) {
      const prefix = `${packageContract.name}@`;
      if (key.startsWith(prefix)) resolvedKeys.add(key.slice(prefix.length).split('(')[0]);
    }
  }
  const unexpectedVersions = [...resolvedKeys]
    .filter((version) => version !== packageContract.required_version)
    .sort();
  if (unexpectedVersions.length > 0) {
    failures.push(
      `lockfile retains unsupported ${packageContract.name} version(s): ${unexpectedVersions.join(', ')}`,
    );
  }
  if (!resolvedKeys.has(packageContract.required_version)) {
    failures.push(`lockfile does not resolve ${packageContract.name}@${packageContract.required_version}`);
  }

  return workspaceConsumerCount;
}

export async function inspectHostHardcut(projectRoot, manifest) {
  const failures = [];

  for (const relativePath of manifest.retired_active_projection_paths) {
    const kind = await pathKind(path.join(projectRoot, ...relativePath.split('/')));
    if (kind !== 'missing') {
      failures.push(`retired active nimi-coding projection is present (${kind}): ${relativePath}`);
    }
  }

  const authorityAbsolutePath = path.join(projectRoot, ...manifest.authority.path.split('/'));
  if (await pathKind(authorityAbsolutePath) !== 'file') {
    failures.push(`nimicoding boundary authority is missing: ${manifest.authority.path}`);
  } else {
    const authorityText = await readFile(authorityAbsolutePath, 'utf8');
    for (const ruleId of manifest.authority.required_rule_ids) {
      if (!authorityText.includes(ruleId)) {
        failures.push(`nimicoding boundary authority is missing rule ${ruleId}: ${manifest.authority.path}`);
      }
    }
  }

  const hostPackageJson = await readJsonFile(
    path.join(projectRoot, PACKAGE_JSON_RELATIVE_PATH),
    'host package.json',
  );
  const dependencyDeclarations = [
    hostPackageJson.dependencies?.[manifest.package.name],
    hostPackageJson.devDependencies?.[manifest.package.name],
  ].filter((value) => value !== undefined);
  if (
    dependencyDeclarations.length !== 1
    || dependencyDeclarations[0] !== manifest.package.required_dependency_range
  ) {
    failures.push(
      `host must declare exactly ${manifest.package.name}@${manifest.package.required_dependency_range}; found ${JSON.stringify(dependencyDeclarations)}`,
    );
  }

  let workspaceConsumerCount = 0;
  const lockfilePath = path.join(projectRoot, LOCKFILE_RELATIVE_PATH);
  if (await pathKind(lockfilePath) !== 'file') {
    failures.push(`workspace lockfile is missing: ${LOCKFILE_RELATIVE_PATH}`);
  } else {
    const lockfile = await readYamlFile(lockfilePath, 'workspace pnpm-lock.yaml');
    workspaceConsumerCount = inspectWorkspaceLockfile(lockfile, manifest.package, failures);
  }

  for (const [scriptName, expectedCommand] of Object.entries(manifest.required_package_scripts)) {
    const actualCommand = hostPackageJson.scripts?.[scriptName];
    if (actualCommand !== expectedCommand) {
      failures.push(
        `package script ${scriptName} must be exactly ${JSON.stringify(expectedCommand)}; found ${JSON.stringify(actualCommand)}`,
      );
    }
  }
  for (const scriptName of manifest.forbidden_package_scripts) {
    if (Object.hasOwn(hostPackageJson.scripts ?? {}, scriptName)) {
      failures.push(`retired nimi-coding package script is present: ${scriptName}`);
    }
  }

  const installedPackageRoot = path.join(
    projectRoot,
    'node_modules',
    ...manifest.package.name.split('/'),
  );
  const installedPackageJsonPath = path.join(installedPackageRoot, 'package.json');
  let installedVersion = null;
  if (await pathKind(installedPackageJsonPath) !== 'file') {
    failures.push(`installed package is missing: ${manifest.package.name}`);
  } else {
    const installedPackageJson = await readJsonFile(installedPackageJsonPath, 'installed nimi-coding package.json');
    installedVersion = installedPackageJson.version ?? null;
    if (installedPackageJson.name !== manifest.package.name) {
      failures.push(`installed package identity is ${JSON.stringify(installedPackageJson.name)}`);
    }
    if (installedPackageJson.version !== manifest.package.required_version) {
      failures.push(
        `installed ${manifest.package.name} version must be ${manifest.package.required_version}; found ${JSON.stringify(installedPackageJson.version)}`,
      );
    }
    for (const relativePath of manifest.forbidden_installed_package_paths) {
      const kind = await pathKind(path.join(installedPackageRoot, ...relativePath.split('/')));
      if (kind !== 'missing') {
        failures.push(`installed nimi-coding restores a retired execution surface (${kind}): ${relativePath}`);
      }
    }
  }

  const scanFiles = [];
  for (const relativeRoot of manifest.entrypoint_scan.roots) {
    scanFiles.push(...await collectScanFiles(projectRoot, relativeRoot, manifest.entrypoint_scan));
  }
  const uniqueScanFiles = [...new Set(scanFiles)].sort();
  const retiredReferencePatterns = [...new Set([
    ...manifest.entrypoint_scan.forbidden_substrings,
    ...manifest.retired_active_projection_paths.map((relativePath) => relativePath.toLowerCase()),
  ])];
  for (const relativePath of uniqueScanFiles) {
    const source = (await readFile(path.join(projectRoot, ...relativePath.split('/')), 'utf8')).toLowerCase();
    for (const forbiddenSubstring of retiredReferencePatterns) {
      if (source.includes(forbiddenSubstring)) {
        failures.push(
          `retired nimi-coding execution reference ${JSON.stringify(forbiddenSubstring)} found in ${relativePath}`,
        );
      }
    }
  }

  const historicalRoots = {};
  for (const relativePath of manifest.preserved_historical_roots) {
    historicalRoots[relativePath] = await pathKind(path.join(projectRoot, ...relativePath.split('/')));
  }

  return {
    ok: failures.length === 0,
    failures,
    packageVersion: installedVersion,
    retiredProjectionCount: manifest.retired_active_projection_paths.length,
    forbiddenInstalledSurfaceCount: manifest.forbidden_installed_package_paths.length,
    workspaceConsumerCount,
    scannedFiles: uniqueScanFiles,
    historicalRoots,
  };
}

export const HOST_HARDCUT_MANIFEST_PATH = MANIFEST_RELATIVE_PATH;
