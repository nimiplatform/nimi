// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-009b

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, parseDocument as parseYamlDocument } from 'yaml';

import { assertManifestAppAccessDeclaration } from './app-access-declaration.mjs';
import { doctorApp } from './app-doctor-update.mjs';
import {
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_LOCK_PATH,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
} from './app-scaffold.mjs';
import { validateAppScaffoldNpmRegistryVersion } from './app-scaffold-capabilities.mjs';

const LEGACY_SCAFFOLD_LOCK_PATH = '.nimi/scaffold.lock.json';
const NPM_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const KIT_OWNED_NATIVE_CARRIERS = Object.freeze([
  '@nimiplatform/kit-protected-local-darwin-arm64',
  '@nimiplatform/kit-protected-local-win32-x64',
]);
const SYNCHRONIZED_NIMI_PACKAGES = new Set([
  '@nimiplatform/sdk',
  '@nimiplatform/kit',
  '@nimiplatform/app-tools',
  '@nimiplatform/nimi-coding',
  ...KIT_OWNED_NATIVE_CARRIERS,
]);

function resolveTargetDir(cwd, options = {}) {
  return path.resolve(cwd, String(options.dir || '').trim() || '.');
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${filePath}: ${message}`);
  }
}

function readSubmittedManifest(targetDir) {
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  if (!existsSync(manifestPath)) {
    throw new Error('Existing submitted app requires nimi.app.yaml');
  }
  const source = readFileSync(manifestPath, 'utf8');
  assertManifestAppAccessDeclaration(source, manifestPath);
  let document;
  try {
    document = parseYaml(source);
  } catch (error) {
    throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const appId = typeof document?.app_id === 'string' ? document.app_id.trim() : '';
  const profile = typeof document?.profile === 'string' ? document.profile.trim() : '';
  if (
    !appId
    || appId !== document?.app_id
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u.test(appId)
    || !SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)
  ) {
    throw new Error('Existing submitted app requires canonical app_id and supported profile');
  }
  if (document?.manifest_role !== 'submitted-input') {
    throw new Error('Submitted manifest marker missing');
  }
  const rendererOrigin = document?.local_development?.electron?.renderer_origin;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(rendererOrigin);
  } catch {
    throw new Error('nimi.app.yaml local_development.electron.renderer_origin must be a canonical loopback origin');
  }
  if (
    typeof rendererOrigin !== 'string'
    || rendererOrigin.trim() !== rendererOrigin
    || parsedOrigin.protocol !== 'http:'
    || parsedOrigin.hostname !== '127.0.0.1'
    || !parsedOrigin.port
    || parsedOrigin.username
    || parsedOrigin.password
    || parsedOrigin.pathname !== '/'
    || parsedOrigin.search
    || parsedOrigin.hash
    || rendererOrigin !== parsedOrigin.origin
  ) {
    throw new Error('nimi.app.yaml local_development.electron.renderer_origin must be a canonical 127.0.0.1 origin');
  }
  return Object.freeze({ appId, profile, rendererOrigin: parsedOrigin.origin });
}

function assertNoRetiredScaffoldState(targetDir) {
  if (existsSync(path.join(targetDir, LEGACY_SCAFFOLD_LOCK_PATH))) {
    throw new Error(`Unsupported legacy scaffold lock: ${LEGACY_SCAFFOLD_LOCK_PATH}`);
  }
  if (
    existsSync(path.join(targetDir, SCAFFOLD_INTENT_PATH))
    && !existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH))
  ) {
    throw new Error(`Missing initialized scaffold lock: ${SCAFFOLD_LOCK_PATH}`);
  }
}

function expectedNimiDependencies(versions) {
  return Object.freeze([
    Object.freeze({ name: '@nimiplatform/sdk', section: 'dependencies', version: versions.sdkVersion }),
    Object.freeze({ name: '@nimiplatform/kit', section: 'dependencies', version: versions.kitVersion }),
    Object.freeze({ name: '@nimiplatform/app-tools', section: 'devDependencies', version: versions.appToolsVersion }),
    Object.freeze({ name: '@nimiplatform/nimi-coding', section: 'devDependencies', version: versions.nimicodingVersion }),
  ]);
}

function dependencySection(packageJson, sectionName) {
  const section = packageJson[sectionName];
  if (section === undefined) return null;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`package.json ${sectionName} must be an object`);
  }
  return section;
}

function isLocalDependencySpec(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^(?:file|link|patch|path|portal|workspace):/iu.test(normalized)
    || /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\\\\)/u.test(normalized)
    || /\.(?:tar\.gz|tgz)(?:[?#].*)?$/iu.test(normalized);
}

function synchronizedNimiPackageName(key) {
  const normalized = String(key || '').replace(/^\/+/, '');
  for (const packageName of SYNCHRONIZED_NIMI_PACKAGES) {
    if (normalized === packageName || normalized.startsWith(`${packageName}@`)) return packageName;
  }
  return '';
}

function installRequiredError(detail) {
  return new Error(`${detail}. Run pnpm install, then rerun nimi-app sync and nimi-app check.`);
}

function assertPublicNimiDependencySpecs(packageJson) {
  for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
    const section = dependencySection(packageJson, sectionName);
    if (!section) continue;
    for (const [name, version] of Object.entries(section)) {
      if (!name.startsWith('@nimiplatform/')) continue;
      if (isLocalDependencySpec(version)) {
        throw new Error(`Nimi dependency must use a public registry version: ${sectionName}.${name}`);
      }
      try {
        validateAppScaffoldNpmRegistryVersion(version, `package.json ${sectionName}.${name}`);
      } catch {
        throw new Error(`Nimi dependency must use a public registry version: ${sectionName}.${name}`);
      }
    }
  }
}

function assertPackageManifestCurrent(packageJson, versions) {
  if (packageJson.packageManager !== versions.packageManager) {
    throw new Error(`package.json packageManager must be ${versions.packageManager}`);
  }
  assertPublicNimiDependencySpecs(packageJson);
  for (const expected of expectedNimiDependencies(versions)) {
    const section = dependencySection(packageJson, expected.section);
    if (section?.[expected.name] !== expected.version) {
      throw new Error(`package.json ${expected.section}.${expected.name} must be ${expected.version}`);
    }
    for (const otherSectionName of NPM_DEPENDENCY_SECTIONS) {
      if (otherSectionName === expected.section) continue;
      const otherSection = dependencySection(packageJson, otherSectionName);
      if (Object.hasOwn(otherSection || {}, expected.name)) {
        throw new Error(`package.json ${expected.name} must appear only in ${expected.section}`);
      }
    }
  }
  for (const carrier of KIT_OWNED_NATIVE_CARRIERS) {
    for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
      if (Object.hasOwn(dependencySection(packageJson, sectionName) || {}, carrier)) {
        throw new Error(`Direct native carrier dependency is Kit-owned and must be removed: ${sectionName}.${carrier}`);
      }
    }
  }
}

function normalizePackageManifest(packageJson, descriptor, versions) {
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json must contain an object');
  }
  const normalized = JSON.parse(JSON.stringify(packageJson));
  for (const sectionName of NPM_DEPENDENCY_SECTIONS) dependencySection(normalized, sectionName);
  for (const expected of expectedNimiDependencies(versions)) {
    for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
      const section = dependencySection(normalized, sectionName);
      if (section) delete section[expected.name];
    }
    normalized[expected.section] ||= {};
    normalized[expected.section][expected.name] = expected.version;
  }
  for (const carrier of KIT_OWNED_NATIVE_CARRIERS) {
    for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
      const section = dependencySection(normalized, sectionName);
      if (section) delete section[carrier];
    }
  }
  normalized.packageManager = versions.packageManager;
  normalized.scripts ||= {};
  if (!normalized.scripts || typeof normalized.scripts !== 'object' || Array.isArray(normalized.scripts)) {
    throw new Error('package.json scripts must be an object');
  }
  if (typeof normalized.scripts['build:electron'] !== 'string' || !normalized.scripts['build:electron'].trim()) {
    throw new Error('package.json build:electron must build the Desktop-supervised Electron host');
  }
  normalized.scripts.dev = 'nimi-app dev --shell electron';
  normalized.scripts['dev:shell'] = 'nimi-app dev';
  normalized.scripts['dev:electron'] = 'nimi-app dev --shell electron';
  normalized.scripts['dev:renderer'] = `vite --host 127.0.0.1 --port ${new URL(descriptor.rendererOrigin).port} --strictPort`;
  normalized.scripts.doctor = 'nimi-app doctor';
  assertPackageManifestCurrent(normalized, versions);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

function parseYamlFile(source, filePath) {
  try {
    return parseYaml(source);
  } catch (error) {
    throw new Error(`Invalid ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizePnpmWorkspace(targetDir) {
  const workspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) return null;
  const source = readFileSync(workspacePath, 'utf8');
  const document = parseYamlDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid pnpm-workspace.yaml: ${document.errors[0].message}`);
  }
  const workspace = document.toJS();
  const overrides = workspace?.overrides;
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new Error('pnpm-workspace.yaml overrides must be an object');
  }
  let removed = false;
  for (const key of Object.keys(overrides || {})) {
    if (synchronizedNimiPackageName(key)) {
      document.deleteIn(['overrides', key]);
      removed = true;
    }
  }
  const remainingOverrides = document.toJS()?.overrides;
  if (remainingOverrides && Object.keys(remainingOverrides).length === 0) document.deleteIn(['overrides']);
  return {
    path: workspacePath,
    previous: source,
    content: removed ? String(document) : source,
  };
}

function assertPnpmWorkspaceCurrent(targetDir) {
  const workspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspacePath)) return;
  const source = readFileSync(workspacePath, 'utf8');
  const workspace = parseYamlFile(source, workspacePath);
  const overrides = workspace?.overrides;
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new Error('pnpm-workspace.yaml overrides must be an object');
  }
  for (const key of Object.keys(overrides || {})) {
    if (synchronizedNimiPackageName(key)) {
      throw installRequiredError(`pnpm-workspace.yaml retains a Nimi dependency override: ${key}`);
    }
  }
}

function findLocalNimiResolution(value, currentPackage = '', pathParts = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = findLocalNimiResolution(value[index], currentPackage, [...pathParts, String(index)]);
      if (finding) return finding;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const packageName = synchronizedNimiPackageName(key) || currentPackage;
    const normalizedKey = String(key).replace(/^\/+/, '');
    if (
      packageName
      && normalizedKey.startsWith(`${packageName}@`)
      && isLocalDependencySpec(normalizedKey.slice(packageName.length + 1))
    ) {
      return [...pathParts, key].join('.');
    }
    if (packageName && typeof child === 'string' && isLocalDependencySpec(child)) {
      return [...pathParts, key].join('.');
    }
    const finding = findLocalNimiResolution(child, packageName, [...pathParts, key]);
    if (finding) return finding;
  }
  return null;
}

function assertPnpmLockCurrent(targetDir) {
  const lockPath = path.join(targetDir, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    throw installRequiredError('pnpm-lock.yaml is missing');
  }
  const lock = parseYamlFile(readFileSync(lockPath, 'utf8'), lockPath);
  const finding = findLocalNimiResolution(lock);
  if (finding) {
    throw installRequiredError(`pnpm-lock.yaml retains a local Nimi resolution at ${finding}`);
  }
}

function cargoDependencyLocations(source) {
  const lines = source.split(/\r?\n/u);
  let section = '';
  const entries = [];
  let dependenciesHeader = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (header) {
      section = header[1];
      if (section === 'dependencies') dependenciesHeader = index;
      continue;
    }
    if (/^\s*nimi-shell-tauri\s*=/u.test(lines[index])) {
      entries.push({ index, section, line: lines[index].trim() });
    }
  }
  return { lines, entries, dependenciesHeader };
}

function normalizeCargoManifest(source, version) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = source.endsWith('\n');
  const { lines, entries, dependenciesHeader } = cargoDependencyLocations(source);
  if (entries.length > 1 || entries.some((entry) => entry.section !== 'dependencies')) {
    throw new Error('src-tauri/Cargo.toml must declare nimi-shell-tauri exactly once under [dependencies]');
  }
  const canonicalLine = `nimi-shell-tauri = "${version}"`;
  if (entries.length === 1) {
    lines[entries[0].index] = canonicalLine;
  } else if (dependenciesHeader >= 0) {
    let insertion = lines.length;
    for (let index = dependenciesHeader + 1; index < lines.length; index += 1) {
      if (/^\s*\[[^\]]+\]/u.test(lines[index])) {
        insertion = index;
        break;
      }
    }
    if (insertion === lines.length && lines.at(-1) === '') insertion -= 1;
    lines.splice(insertion, 0, canonicalLine);
  } else {
    if (lines.at(-1) === '') lines.pop();
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
    lines.push('[dependencies]', canonicalLine);
  }
  const rendered = lines.join(newline);
  return hadFinalNewline && !rendered.endsWith(newline) ? `${rendered}${newline}` : rendered;
}

function assertCargoManifestCurrent(source, version) {
  const { entries } = cargoDependencyLocations(source);
  const expected = `nimi-shell-tauri = "${version}"`;
  if (entries.length !== 1 || entries[0].section !== 'dependencies' || entries[0].line !== expected) {
    throw new Error(`src-tauri/Cargo.toml nimi-shell-tauri must use exact public version ${version}`);
  }
}

function normalizeTauriConfig(config, appId) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('src-tauri/tauri.conf.json must contain an object');
  }
  const normalized = JSON.parse(JSON.stringify(config));
  normalized.identifier = `ai.nimi.apps.${appId}`;
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

function assertTauriConfigCurrent(config, appId) {
  const expected = `ai.nimi.apps.${appId}`;
  if (config?.identifier !== expected) {
    throw new Error(`src-tauri/tauri.conf.json identifier must be ${expected}`);
  }
}

function readProjectLifecycleFiles(targetDir) {
  const packagePath = path.join(targetDir, 'package.json');
  const cargoPath = path.join(targetDir, 'src-tauri', 'Cargo.toml');
  const tauriPath = path.join(targetDir, 'src-tauri', 'tauri.conf.json');
  for (const requiredPath of [packagePath, cargoPath, tauriPath]) {
    if (!existsSync(requiredPath)) throw new Error(`Required App lifecycle file is missing: ${path.relative(targetDir, requiredPath)}`);
  }
  return {
    packagePath,
    packageSource: readFileSync(packagePath, 'utf8'),
    packageJson: readJsonFile(packagePath, 'package.json'),
    cargoPath,
    cargoSource: readFileSync(cargoPath, 'utf8'),
    tauriPath,
    tauriSource: readFileSync(tauriPath, 'utf8'),
    tauriConfig: readJsonFile(tauriPath, 'src-tauri/tauri.conf.json'),
  };
}

function assertProjectLifecycleCurrent(targetDir, versions, options = {}) {
  const descriptor = readSubmittedManifest(targetDir);
  const files = readProjectLifecycleFiles(targetDir);
  assertPackageManifestCurrent(files.packageJson, versions);
  assertCargoManifestCurrent(files.cargoSource, versions.nimiShellTauriVersion);
  assertTauriConfigCurrent(files.tauriConfig, descriptor.appId);
  assertPnpmWorkspaceCurrent(targetDir);
  if (options.requireInstalledLock === true) assertPnpmLockCurrent(targetDir);
  return { descriptor, files };
}

function buildExistingSubmittedAppSyncPlan(targetDir, versions) {
  const descriptor = readSubmittedManifest(targetDir);
  const files = readProjectLifecycleFiles(targetDir);
  const planned = [
    { path: files.packagePath, content: normalizePackageManifest(files.packageJson, descriptor, versions), previous: files.packageSource },
    { path: files.cargoPath, content: normalizeCargoManifest(files.cargoSource, versions.nimiShellTauriVersion), previous: files.cargoSource },
    { path: files.tauriPath, content: normalizeTauriConfig(files.tauriConfig, descriptor.appId), previous: files.tauriSource },
  ];
  const workspace = normalizePnpmWorkspace(targetDir);
  if (workspace) planned.push(workspace);
  return { descriptor, planned };
}

function runNimicodingSync(targetDir, mode, runners) {
  if (!runners?.runNimicodingSync) throw new Error('Missing nimicoding sync runner');
  const result = runners.runNimicodingSync(targetDir, mode);
  if (result && result.ok === false) {
    throw new Error(`nimicoding package-owned projection ${mode} failed`);
  }
  return result;
}

function emitResult(payload, options, message) {
  if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(`[nimi-app] ${message}\n`);
  return payload;
}

export function syncAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  const plan = managed ? null : buildExistingSubmittedAppSyncPlan(targetDir, versions);
  const nimicoding = runNimicodingSync(targetDir, 'apply', runners);
  const synchronizedFiles = [];
  for (const file of plan?.planned || []) {
    if (file.content === file.previous) continue;
    writeFileSync(file.path, file.content);
    synchronizedFiles.push(path.relative(targetDir, file.path).split(path.sep).join('/'));
  }
  doctorApp(cwd, { dir: targetDir, silent: true }, versions, runners);
  assertProjectLifecycleCurrent(targetDir, versions);
  return emitResult({
    ok: true,
    command: 'sync',
    dir: targetDir,
    managed,
    appId: plan?.descriptor.appId || readSubmittedManifest(targetDir).appId,
    synchronizedFiles,
    nimicodingSync: nimicoding?.summary || null,
    nextSteps: ['pnpm install', 'nimi-app sync', 'nimi-app check'],
  }, options, `sync completed for ${targetDir}`);
}

export function checkAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  const doctor = doctorApp(cwd, { dir: targetDir, silent: true }, versions, runners);
  let nimicoding = null;
  if (!managed) nimicoding = runNimicodingSync(targetDir, 'check', runners);
  const { descriptor } = assertProjectLifecycleCurrent(targetDir, versions, { requireInstalledLock: true });
  return emitResult({
    ok: true,
    command: 'check',
    dir: targetDir,
    managed,
    appId: descriptor.appId,
    profile: descriptor.profile,
    checkedManagedFiles: doctor.checkedManagedFiles,
    checkedExistingFiles: doctor.checkedExistingFiles,
    nimicodingSync: nimicoding?.summary || null,
  }, options, `check passed for ${targetDir}`);
}
