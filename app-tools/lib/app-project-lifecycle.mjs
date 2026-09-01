// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-009b

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, parseDocument as parseYamlDocument, stringify as stringifyYaml } from 'yaml';

import { assertManifestAppAccessDeclaration } from './app-access-declaration.mjs';
import { syncManagedApp, validateAppProject } from './app-doctor-update.mjs';
import {
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_LOCK_PATH,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  managedAppReleaseWorkflowSource,
  renderAppBuildProfile,
  renderAppIdentityInput,
  renderAppSubmissionInput,
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
const BUILD_PROFILE_PATH = '.nimi/config/build-profile.yaml';
const MANAGED_WORKFLOW_PATH = '.github/workflows/nimi-app-release.yml';
const APP_IDENTITY_PATH = '.nimi/config/app-identity.yaml';
const SUBMISSION_PATH = '.nimi/admission/submission.yaml';
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const CURRENT_APP_TARGETS = Object.freeze({
  'windows-x86_64': Object.freeze({ os: 'windows', arch: 'x86_64' }),
});

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
  const displayName = typeof document?.display_name === 'string' ? document.display_name : '';
  const profile = typeof document?.profile === 'string' ? document.profile.trim() : '';
  if (
    !appId
    || appId !== document?.app_id
    || !displayName.trim()
    || displayName !== displayName.trim()
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(appId)
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
  const version = typeof document?.version === 'string' ? document.version : '';
  if (!SEMVER_PATTERN.test(version) || version !== document.version) {
    throw new Error('Existing submitted app version must be an exact semantic version');
  }
  return Object.freeze({ appId, displayName, profile, version, rendererOrigin: parsedOrigin.origin });
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
  if (packageJson.private !== true || Object.hasOwn(packageJson, 'publishConfig')) {
    throw new Error('Nimi App package.json must be private and must not declare npm publishConfig');
  }
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
  const scripts = dependencySection({ scripts: packageJson.scripts }, 'scripts') || {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') throw new Error(`package.json scripts.${name} must be a string`);
    if (/\bnimi-app\s+(?:doctor|update)\b/u.test(command) || /\bpnpm\s+run\s+(?:doctor|update)\b/u.test(command)) {
      throw new Error(`package.json scripts.${name} retains a retired nimi-app command`);
    }
    if (
      /^(?:preinstall|install|postinstall|prepare|prepublishOnly)$/u.test(name)
      && (/\bnimi-app\s+(?:init|sync)\b/u.test(command) || /\bnimicoding\s+sync\s+--apply\b/u.test(command))
    ) {
      throw new Error(`package.json scripts.${name} must not mutate managed App state during dependency installation`);
    }
  }
  if (scripts.pack !== 'nimi-app pack') {
    throw new Error('package.json scripts.pack must use the canonical nimi-app pack owner');
  }
  if (scripts.publish !== undefined) {
    throw new Error('package.json scripts.publish is unavailable until publisher GitHub and registry orchestration is implemented');
  }
}

function normalizePackageManifest(packageJson, descriptor, versions) {
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json must contain an object');
  }
  const normalized = JSON.parse(JSON.stringify(packageJson));
  normalized.private = true;
  delete normalized.publishConfig;
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
  normalized.scripts.sync ||= 'nimi-app sync';
  normalized.scripts.pack = 'nimi-app pack';
  delete normalized.scripts.publish;
  for (const name of ['doctor', 'update']) {
    if (/^nimi-app\s+(?:doctor|update)$/u.test(String(normalized.scripts[name] || '').trim())) {
      delete normalized.scripts[name];
    }
  }
  for (const [name, command] of Object.entries(normalized.scripts)) {
    if (typeof command !== 'string') continue;
    normalized.scripts[name] = command
      .replace(/\bpnpm\s+run\s+doctor\s*&&\s*/gu, '')
      .replace(/\bnimi-app\s+doctor\s*&&\s*/gu, '');
  }
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

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain an object`);
  return value;
}

function assertExactKeys(value, label, required, optional = []) {
  const object = requireObject(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) throw new Error(`${label} is missing required field: ${key}`);
  }
  return object;
}

function canonicalInputText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\0\r\n]/u.test(value)) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function canonicalInputList(value, label, allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
  const entries = value.map((item, index) => canonicalInputText(item, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) throw new Error(`${label} must not contain duplicates`);
  return entries;
}

function normalizeSupportInput(value, label) {
  const support = assertExactKeys(value, label, [
    'diagnostics_bundle_fields',
    'redaction_rules',
    'user_visible_issue_categories',
    'escalation_path',
    'kill_switch_visibility',
    'recovery_instructions',
  ]);
  if (support.kill_switch_visibility !== 'visible') throw new Error(`${label}.kill_switch_visibility must be visible`);
  return {
    diagnostics_bundle_fields: canonicalInputList(support.diagnostics_bundle_fields, `${label}.diagnostics_bundle_fields`, false),
    redaction_rules: canonicalInputList(support.redaction_rules, `${label}.redaction_rules`, false),
    user_visible_issue_categories: canonicalInputList(support.user_visible_issue_categories, `${label}.user_visible_issue_categories`, false),
    escalation_path: canonicalInputText(support.escalation_path, `${label}.escalation_path`),
    kill_switch_visibility: 'visible',
    recovery_instructions: canonicalInputText(support.recovery_instructions, `${label}.recovery_instructions`),
  };
}

function normalizeStorageInput(value, label) {
  const storage = requireObject(value, label);
  if (storage.kind === 'nimi-mediated-default') {
    assertExactKeys(storage, label, ['kind']);
    return { kind: 'nimi-mediated-default' };
  }
  if (storage.kind !== 'app-owned-os-storage') throw new Error(`${label}.kind is unsupported`);
  assertExactKeys(storage, label, ['kind', 'os_storage_disclosure']);
  if (!Array.isArray(storage.os_storage_disclosure) || storage.os_storage_disclosure.length === 0) {
    throw new Error(`${label}.os_storage_disclosure must be a non-empty array`);
  }
  return {
    kind: storage.kind,
    os_storage_disclosure: storage.os_storage_disclosure.map((entry, index) => {
      const item = assertExactKeys(entry, `${label}.os_storage_disclosure[${index}]`, ['path_pattern', 'purpose', 'expected_size_band']);
      return {
        path_pattern: canonicalInputText(item.path_pattern, `${label}.os_storage_disclosure[${index}].path_pattern`),
        purpose: canonicalInputText(item.purpose, `${label}.os_storage_disclosure[${index}].purpose`),
        expected_size_band: canonicalInputText(item.expected_size_band, `${label}.os_storage_disclosure[${index}].expected_size_band`),
      };
    }),
  };
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

function assertPnpmLockCurrent(targetDir, packageJson) {
  const lockPath = path.join(targetDir, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    throw installRequiredError('pnpm-lock.yaml is missing');
  }
  const lock = parseYamlFile(readFileSync(lockPath, 'utf8'), lockPath);
  const finding = findLocalNimiResolution(lock);
  if (finding) {
    throw installRequiredError(`pnpm-lock.yaml retains a local Nimi resolution at ${finding}`);
  }
  const importer = lock?.importers?.['.'];
  if (!importer || typeof importer !== 'object' || Array.isArray(importer)) {
    throw installRequiredError('pnpm-lock.yaml root importer is missing');
  }
  for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
    const packageSection = dependencySection(packageJson, sectionName) || {};
    const lockSection = importer[sectionName] || {};
    for (const [name, specifier] of Object.entries(packageSection)) {
      if (!name.startsWith('@nimiplatform/')) continue;
      if (lockSection?.[name]?.specifier !== specifier) {
        throw installRequiredError(`pnpm-lock.yaml ${sectionName}.${name} specifier does not match package.json`);
      }
    }
    for (const name of Object.keys(lockSection || {})) {
      if (name.startsWith('@nimiplatform/') && !Object.hasOwn(packageSection, name)) {
        throw installRequiredError(`pnpm-lock.yaml retains stale Nimi dependency: ${sectionName}.${name}`);
      }
    }
  }
}

function assertCargoLockCurrent(targetDir, version) {
  const cargoLockError = (detail) => new Error(`${detail}. Run cargo update -p nimi-shell-tauri --precise ${version}, then rerun nimi-app check.`);
  const lockPath = path.join(targetDir, 'src-tauri', 'Cargo.lock');
  if (!existsSync(lockPath)) {
    throw cargoLockError('src-tauri/Cargo.lock is missing');
  }
  const blocks = readFileSync(lockPath, 'utf8').split(/\r?\n\[\[package\]\]\r?\n/u);
  const block = blocks.find((entry) => /^name\s*=\s*"nimi-shell-tauri"\s*$/mu.test(entry));
  if (!block) throw cargoLockError('src-tauri/Cargo.lock is missing nimi-shell-tauri');
  const lockedVersion = block.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const source = block.match(/^source\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const checksum = block.match(/^checksum\s*=\s*"([a-f0-9]{64})"\s*$/mu)?.[1];
  if (lockedVersion !== version || !source?.startsWith('registry+') || !checksum) {
    throw cargoLockError(`src-tauri/Cargo.lock nimi-shell-tauri must resolve registry version ${version} with checksum`);
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

function normalizeStandaloneSourceFiles(targetDir) {
  const planned = [];
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    const filePath = path.join(targetDir, name);
    if (!existsSync(filePath)) continue;
    const previous = readFileSync(filePath, 'utf8');
    let content = previous
      .replace(/^const nimiRepoRoot\s*=.*\r?\n/gmu, '')
      .replace(/^const nimiSdkSourceRoot\s*=.*\r?\n/gmu, '')
      .replace(/^const nimiKitSourceRoot\s*=.*\r?\n/gmu, '')
      .replace(/^\s*\|\|\s*normalizedId\.includes\(['"]\/nimi-realm\/nimi\/(?:sdks\/typescript|kit)\/['"]\)\r?\n/gmu, '')
      .replace(/^\s*\{\s*find:\s*\/\^@nimiplatform\\\/(?:sdk|kit).*replacement:\s*path\.resolve\(nimi(?:Sdk|Kit)SourceRoot.*\r?\n/gmu, '')
      .replace(/\n\s*server:\s*\{\s*\n\s*fs:\s*\{\s*\n\s*allow:\s*\[\s*\n\s*appRoot,\s*\n\s*nimiRepoRoot,\s*\n\s*\],\s*\n\s*\},\s*\n\s*\},?/mu, '\n');
    if (!content.includes('appRoot')) content = content.replace(/^const appRoot\s*=.*\r?\n/gmu, '');
    planned.push({ path: filePath, content, previous });
  }
  const stylesPath = path.join(targetDir, 'src', 'styles.css');
  if (existsSync(stylesPath)) {
    const previous = readFileSync(stylesPath, 'utf8');
    const content = previous.replace(
      /^@source\s+["'][^"']*\/nimi\/kit\/\*\*\/\*\.\{ts,tsx\}["'];?\r?$/gmu,
      '@source "../node_modules/@nimiplatform/kit/**/*.{js,mjs,ts,tsx}";',
    );
    planned.push({ path: stylesPath, content, previous });
  }
  return planned;
}

function assertNoStandaloneParentSources(targetDir) {
  for (const relativePath of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'src/styles.css']) {
    const filePath = path.join(targetDir, ...relativePath.split('/'));
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, 'utf8');
    if (
      /nimiRepoRoot|nimiSdkSourceRoot|nimiKitSourceRoot|\/nimi-realm\/nimi\/(?:sdks|kit)\//u.test(source)
      || /find:\s*\/\^@nimiplatform\\\/(?:sdk|kit)(?:\\\/|\$)/u.test(source)
      || /server\s*:\s*\{[\s\S]*?fs\s*:\s*\{[\s\S]*?allow\s*:/u.test(source)
      || /@source\s+["'][^"']*\/nimi\/kit\//u.test(source)
      || /(?:\.\.[\\/])+(?:nimi[\\/])?(?:sdks|kit)(?:[\\/]|['"])/u.test(source)
    ) {
      throw new Error(`Standalone App retains a parent Nimi source path: ${relativePath}`);
    }
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

function readCargoPackageVersion(source) {
  let inPackage = false;
  for (const line of source.split(/\r?\n/u)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (header) {
      inPackage = header[1] === 'package';
      continue;
    }
    if (!inPackage) continue;
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/u);
    if (match) return match[1];
  }
  throw new Error('src-tauri/Cargo.toml [package] version is missing');
}

function readCargoPackageName(source) {
  let inPackage = false;
  for (const line of source.split(/\r?\n/u)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (header) {
      inPackage = header[1] === 'package';
      continue;
    }
    if (!inPackage) continue;
    const match = line.match(/^\s*name\s*=\s*"([^"]+)"\s*(?:#.*)?$/u);
    if (match) return match[1];
  }
  throw new Error('src-tauri/Cargo.toml [package] name is missing');
}

function assertVersionLockstep(files, descriptor) {
  const version = files.packageJson.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('package.json version must be an exact semantic version');
  }
  const observed = [
    ['nimi.app.yaml', descriptor.version],
    ['src-tauri/Cargo.toml', readCargoPackageVersion(files.cargoSource)],
    ['src-tauri/tauri.conf.json', files.tauriConfig.version],
  ];
  for (const [name, candidate] of observed) {
    if (candidate !== null && candidate !== undefined && candidate !== version) {
      throw new Error(`${name} version must match package.json version ${version}`);
    }
  }
  return version;
}

function assertCanonicalAuthoringInputs(targetDir, descriptor, files, version) {
  const identityPath = path.join(targetDir, APP_IDENTITY_PATH);
  const submissionPath = path.join(targetDir, SUBMISSION_PATH);
  if (!existsSync(identityPath)) throw new Error(`Required App lifecycle file is missing: ${APP_IDENTITY_PATH}`);
  if (!existsSync(submissionPath)) throw new Error(`Required App lifecycle file is missing: ${SUBMISSION_PATH}`);
  const identity = assertExactKeys(parseYamlFile(readFileSync(identityPath, 'utf8'), identityPath), APP_IDENTITY_PATH, [
    'app_id', 'display_name', 'version', 'npm_package_name', 'cargo_package_name', 'tauri_identifier', 'package_author', 'identity_role',
  ]);
  const packageAuthor = files.packageJson.author === undefined ? null : files.packageJson.author;
  if (packageAuthor !== null) canonicalInputText(packageAuthor, 'package.json author');
  const expectedIdentity = {
    app_id: descriptor.appId,
    display_name: descriptor.displayName,
    version,
    npm_package_name: canonicalInputText(files.packageJson.name, 'package.json name'),
    cargo_package_name: readCargoPackageName(files.cargoSource),
    tauri_identifier: files.tauriConfig.identifier,
    package_author: packageAuthor,
    identity_role: 'scaffold-generated-authoring-input',
  };
  for (const [key, expected] of Object.entries(expectedIdentity)) {
    if (identity[key] !== expected) throw new Error(`${APP_IDENTITY_PATH} ${key} must match its canonical owner`);
  }

  const submission = assertExactKeys(parseYamlFile(readFileSync(submissionPath, 'utf8'), submissionPath), SUBMISSION_PATH, [
    'app_id',
    'display_name',
    'version',
    'profile',
    'npm_package_name',
    'cargo_package_name',
    'tauri_identifier',
    'package_author',
    'submission_role',
    'capability_contract_refs',
    'required_standardized_feature_refs',
    'storage_policy',
    'support_manifest',
    'review_inputs',
    'admission_truth',
  ], ['ai_profile_recommendation_ref']);
  const expectedSubmissionIdentity = {
    app_id: descriptor.appId,
    display_name: descriptor.displayName,
    version,
    profile: descriptor.profile,
    npm_package_name: expectedIdentity.npm_package_name,
    cargo_package_name: expectedIdentity.cargo_package_name,
    tauri_identifier: expectedIdentity.tauri_identifier,
    package_author: packageAuthor,
    submission_role: 'developer-submitted-input',
    admission_truth: 'platform-owned-after-review',
  };
  for (const [key, expected] of Object.entries(expectedSubmissionIdentity)) {
    if (submission[key] !== expected) throw new Error(`${SUBMISSION_PATH} ${key} must match its canonical owner`);
  }
  canonicalInputList(submission.capability_contract_refs, `${SUBMISSION_PATH} capability_contract_refs`);
  canonicalInputList(submission.required_standardized_feature_refs, `${SUBMISSION_PATH} required_standardized_feature_refs`);
  if (submission.ai_profile_recommendation_ref !== undefined) {
    canonicalInputText(submission.ai_profile_recommendation_ref, `${SUBMISSION_PATH} ai_profile_recommendation_ref`);
  }
  normalizeStorageInput(submission.storage_policy, `${SUBMISSION_PATH} storage_policy`);
  normalizeSupportInput(submission.support_manifest, `${SUBMISSION_PATH} support_manifest`);
  const reviewInputs = assertExactKeys(submission.review_inputs, `${SUBMISSION_PATH} review_inputs`, ['manifest', 'build_profile', 'scaffold_boundary']);
  const expectedReviewInputs = {
    manifest: 'nimi.app.yaml',
    build_profile: BUILD_PROFILE_PATH,
    scaffold_boundary: '.nimi/contracts/scaffold-boundary.yaml',
  };
  for (const [key, expected] of Object.entries(expectedReviewInputs)) {
    if (reviewInputs[key] !== expected) throw new Error(`${SUBMISSION_PATH} review_inputs.${key} must be ${expected}`);
  }
  return { identity, submission };
}

function assertManagedWorkflowCurrent(targetDir) {
  const workflowPath = path.join(targetDir, MANAGED_WORKFLOW_PATH);
  if (!existsSync(workflowPath)) throw new Error(`Required App lifecycle file is missing: ${MANAGED_WORKFLOW_PATH}`);
  if (readFileSync(workflowPath, 'utf8') !== managedAppReleaseWorkflowSource()) {
    throw new Error(`${MANAGED_WORKFLOW_PATH} must match the app-tools managed workflow`);
  }
  const workflowDir = path.dirname(workflowPath);
  for (const name of readdirSync(workflowDir).sort()) {
    const candidatePath = path.join(workflowDir, name);
    if (candidatePath === workflowPath || !/\.ya?ml$/iu.test(name)) continue;
    const source = readFileSync(candidatePath, 'utf8');
    if (
      /\bgh\s+release\s+(?:create|upload|edit|delete)\b/iu.test(source)
      || /(?:softprops\/action-gh-release|ncipollo\/release-action|actions\/create-release)/iu.test(source)
      || /candidate-uploads|\/api\/platform\/apps\/candidates/iu.test(source)
    ) {
      throw new Error(`Parallel App production workflow is forbidden: .github/workflows/${name}`);
    }
  }
  if (existsSync(path.join(targetDir, 'scripts', 'pack.mjs'))) {
    throw new Error('App-local scripts/pack.mjs is forbidden; use nimi-app pack');
  }
}

function canonicalOwnerCommand(value, field) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\r\n\0]/u.test(value)) {
    throw new Error(`${field} must be a non-empty single-line command`);
  }
  if (/\bnimi-app\s+(?:test|build)\b/u.test(value)) {
    throw new Error(`${field} must not recursively invoke nimi-app test or build`);
  }
  return value;
}

function canonicalProjectPath(value, field) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\')) {
    throw new Error(`${field} must be a canonical relative path`);
  }
  const parts = value.split('/');
  if (value.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${field} must be a canonical relative path`);
  }
  return value;
}

function readBuildProfile(targetDir) {
  const filePath = path.join(targetDir, BUILD_PROFILE_PATH);
  if (!existsSync(filePath)) throw new Error(`Required App lifecycle file is missing: ${BUILD_PROFILE_PATH}`);
  const profile = parseYamlFile(readFileSync(filePath, 'utf8'), filePath);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`${BUILD_PROFILE_PATH} must contain an object`);
  }
  if (profile.profile_role !== 'developer-workflow-input') {
    throw new Error(`${BUILD_PROFILE_PATH} profile_role must be developer-workflow-input`);
  }
  const targets = profile.targets === undefined ? {} : profile.targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw new Error(`${BUILD_PROFILE_PATH} targets must be an object`);
  }
  if (Object.keys(targets).length === 0) {
    throw new Error(`${BUILD_PROFILE_PATH} must declare at least one target`);
  }
  for (const [targetId, target] of Object.entries(targets)) {
    const expected = CURRENT_APP_TARGETS[targetId];
    if (!expected || !target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error(`${BUILD_PROFILE_PATH} declares unsupported target: ${targetId}`);
    }
    if (target.os !== expected.os || target.arch !== expected.arch) {
      throw new Error(`${BUILD_PROFILE_PATH} target identity mismatch: ${targetId}`);
    }
  }
  return {
    testCommand: canonicalOwnerCommand(profile.test_command, `${BUILD_PROFILE_PATH} test_command`),
    buildCommand: canonicalOwnerCommand(profile.build_command, `${BUILD_PROFILE_PATH} build_command`),
    targets,
  };
}

function currentTargetId() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x86_64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'macos-aarch64';
  throw new Error(`Unsupported App build host: ${process.platform}-${process.arch}`);
}

function selectBuildOwner(profile, requestedTarget) {
  const target = String(requestedTarget || '').trim() || currentTargetId();
  const targetProfile = profile.targets[target];
  if (Object.keys(profile.targets).length > 0 && (!targetProfile || typeof targetProfile !== 'object' || Array.isArray(targetProfile))) {
    throw new Error(`Unsupported App build target: ${target}`);
  }
  const command = targetProfile?.build_command === undefined
    ? profile.buildCommand
    : canonicalOwnerCommand(targetProfile.build_command, `${BUILD_PROFILE_PATH} targets.${target}.build_command`);
  const payloadPath = canonicalProjectPath(targetProfile?.payload_path, `${BUILD_PROFILE_PATH} targets.${target}.payload_path`);
  const runtimeEntry = canonicalProjectPath(targetProfile?.runtime_entry, `${BUILD_PROFILE_PATH} targets.${target}.runtime_entry`);
  if (!runtimeEntry.startsWith('payload/')) {
    throw new Error(`${BUILD_PROFILE_PATH} targets.${target}.runtime_entry must resolve inside the packaged payload`);
  }
  return { target, command, payloadPath, runtimeEntry };
}

function resolveProductionSignTarget(targetDir, selected) {
  const projectRoot = path.resolve(targetDir);
  const payloadPath = path.resolve(projectRoot, ...selected.payloadPath.split('/'));
  const projectPrefix = `${projectRoot}${path.sep}`;
  if (!payloadPath.startsWith(projectPrefix) || !existsSync(payloadPath)) {
    throw new Error(`Production payload is missing or noncanonical: ${selected.payloadPath}`);
  }
  const payloadStat = lstatSync(payloadPath);
  let signTarget = payloadPath;
  if (payloadStat.isDirectory()) {
    const runtimeRelative = selected.runtimeEntry.slice('payload/'.length);
    signTarget = path.resolve(payloadPath, ...runtimeRelative.split('/'));
  } else if (!payloadStat.isFile() || payloadStat.isSymbolicLink()) {
    throw new Error(`Production payload is not a direct file or directory: ${selected.payloadPath}`);
  }
  const payloadPrefix = `${payloadPath}${path.sep}`;
  if (
    !existsSync(signTarget)
    || (!payloadStat.isFile() && !signTarget.startsWith(payloadPrefix))
  ) {
    throw new Error(`Production Runtime entry is missing or noncanonical: ${selected.runtimeEntry}`);
  }
  const signTargetStat = lstatSync(signTarget);
  if (!signTargetStat.isFile() || signTargetStat.isSymbolicLink()) {
    throw new Error(`Production Runtime entry must be a direct regular file: ${selected.runtimeEntry}`);
  }
  return path.relative(projectRoot, signTarget).split(path.sep).join('/');
}

function runOwnerCommand(targetDir, kind, command, options, runners) {
  if (typeof runners?.runAppCommand !== 'function') throw new Error('Missing App command runner');
  const result = runners.runAppCommand(targetDir, command, { capture: options.json === true });
  if (!result || result.status !== 0) {
    const detail = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${kind} command failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function assertProjectLifecycleCurrent(targetDir, versions, options = {}) {
  const descriptor = readSubmittedManifest(targetDir);
  const files = readProjectLifecycleFiles(targetDir);
  assertPackageManifestCurrent(files.packageJson, versions);
  const version = assertVersionLockstep(files, descriptor);
  assertCargoManifestCurrent(files.cargoSource, versions.nimiShellTauriVersion);
  assertTauriConfigCurrent(files.tauriConfig, descriptor.appId);
  assertNoStandaloneParentSources(targetDir);
  const authoring = assertCanonicalAuthoringInputs(targetDir, descriptor, files, version);
  if (existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH))) {
    const lock = readJsonFile(path.join(targetDir, SCAFFOLD_LOCK_PATH), 'scaffold lock');
    for (const [field, expected] of [
      ['capability_contract_refs', lock.capabilityContractRefs],
      ['required_standardized_feature_refs', lock.requiredStandardizedFeatureRefs],
    ]) {
      if (JSON.stringify(authoring.submission[field]) !== JSON.stringify(expected || [])) {
        throw new Error(`${SUBMISSION_PATH} ${field} must match the selected scaffold feature closure`);
      }
    }
  }
  const buildProfile = readBuildProfile(targetDir);
  assertManagedWorkflowCurrent(targetDir);
  assertPnpmWorkspaceCurrent(targetDir);
  if (options.requireInstalledLock === true) {
    assertPnpmLockCurrent(targetDir, files.packageJson);
    assertCargoLockCurrent(targetDir, versions.nimiShellTauriVersion);
  }
  return { descriptor, files, version, buildProfile, authoring };
}

function buildExistingSubmittedAppSyncPlan(targetDir, versions) {
  const descriptor = readSubmittedManifest(targetDir);
  const files = readProjectLifecycleFiles(targetDir);
  const version = files.packageJson.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('package.json version must be an exact semantic version before sync');
  }
  const identity = {
    appId: descriptor.appId,
    appTitle: descriptor.displayName,
    version,
    profile: descriptor.profile,
    packageName: files.packageJson.name,
    cargoPackageName: readCargoPackageName(files.cargoSource),
    tauriIdentifier: `ai.nimi.apps.${descriptor.appId}`,
    author: typeof files.packageJson.author === 'string' ? files.packageJson.author : '',
  };
  const planned = [
    { path: files.packagePath, content: normalizePackageManifest(files.packageJson, descriptor, versions), previous: files.packageSource },
    { path: files.cargoPath, content: normalizeCargoManifest(files.cargoSource, versions.nimiShellTauriVersion), previous: files.cargoSource },
    { path: files.tauriPath, content: normalizeTauriConfig(files.tauriConfig, descriptor.appId), previous: files.tauriSource },
  ];
  planned.push(...normalizeStandaloneSourceFiles(targetDir));
  const identityPath = path.join(targetDir, APP_IDENTITY_PATH);
  planned.push({
    path: identityPath,
    content: renderAppIdentityInput(identity),
    previous: existsSync(identityPath) ? readFileSync(identityPath, 'utf8') : '',
  });
  const submissionPath = path.join(targetDir, SUBMISSION_PATH);
  const currentSubmissionSource = existsSync(submissionPath) ? readFileSync(submissionPath, 'utf8') : '';
  const currentSubmission = currentSubmissionSource ? parseYamlFile(currentSubmissionSource, submissionPath) : null;
  let supportManifest;
  if (currentSubmission) {
    assertExactKeys(currentSubmission, SUBMISSION_PATH, [
      'app_id',
      'display_name',
      'version',
      'profile',
      'npm_package_name',
      'cargo_package_name',
      'tauri_identifier',
      'package_author',
      'submission_role',
      'capability_contract_refs',
      'required_standardized_feature_refs',
      'storage_policy',
      'support_manifest',
      'review_inputs',
      'admission_truth',
    ], ['ai_profile_recommendation_ref']);
    canonicalInputList(currentSubmission.capability_contract_refs, `${SUBMISSION_PATH} capability_contract_refs`);
    canonicalInputList(currentSubmission.required_standardized_feature_refs, `${SUBMISSION_PATH} required_standardized_feature_refs`);
    normalizeStorageInput(currentSubmission.storage_policy, `${SUBMISSION_PATH} storage_policy`);
    supportManifest = normalizeSupportInput(currentSubmission.support_manifest, `${SUBMISSION_PATH} support_manifest`);
  }
  const submissionContent = renderAppSubmissionInput(identity, {
    capabilityContractRefs: currentSubmission?.capability_contract_refs || [],
    requiredStandardizedFeatureRefs: currentSubmission?.required_standardized_feature_refs || [],
    aiProfileRecommendationRef: currentSubmission?.ai_profile_recommendation_ref,
    storagePolicy: currentSubmission?.storage_policy || { kind: 'nimi-mediated-default' },
    supportManifest,
  });
  planned.push({ path: submissionPath, content: submissionContent, previous: currentSubmissionSource });
  const buildProfilePath = path.join(targetDir, BUILD_PROFILE_PATH);
  const currentBuildProfile = existsSync(buildProfilePath) ? readFileSync(buildProfilePath, 'utf8') : '';
  const buildProfile = currentBuildProfile
    ? parseYamlFile(currentBuildProfile, buildProfilePath)
    : {};
  const scripts = files.packageJson.scripts || {};
  const testCommand = buildProfile.test_command
    || (typeof scripts['test:app'] === 'string' ? 'pnpm run test:app' : null)
    || (typeof scripts.test === 'string' && !/\bnimi-app\s+test\b/u.test(scripts.test) ? 'pnpm run test' : null);
  const buildCommand = buildProfile.build_command
    || (typeof scripts['build:shell'] === 'string' ? 'pnpm run build:shell' : null)
    || (typeof scripts.build === 'string' && !/\bnimi-app\s+build\b/u.test(scripts.build) ? 'pnpm run build' : null);
  if (!testCommand || !buildCommand) {
    throw new Error('Existing submitted App requires declared test and build owner commands');
  }
  const normalizedBuildProfile = currentBuildProfile
    ? stringifyYaml({
      ...buildProfile,
      test_command: testCommand,
      build_command: buildCommand,
      profile_role: 'developer-workflow-input',
    }, { lineWidth: 0 })
    : renderAppBuildProfile({ testCommand, buildCommand });
  planned.push({
    path: buildProfilePath,
    content: normalizedBuildProfile,
    previous: currentBuildProfile,
  });
  const workflowPath = path.join(targetDir, MANAGED_WORKFLOW_PATH);
  planned.push({
    path: workflowPath,
    content: managedAppReleaseWorkflowSource(),
    previous: existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '',
  });
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

function applySyncPlan(targetDir, plan) {
  const synchronizedFiles = [];
  for (const file of plan.planned) {
    if (file.content === file.previous) continue;
    mkdirSync(path.dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
    synchronizedFiles.push(path.relative(targetDir, file.path).split(path.sep).join('/'));
  }
  return synchronizedFiles;
}

export function syncAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  if (managed) {
    const refreshed = syncManagedApp(cwd, { dir: targetDir, silent: true }, versions, runners);
    const plan = buildExistingSubmittedAppSyncPlan(targetDir, versions);
    const synchronizedFiles = applySyncPlan(targetDir, plan);
    validateAppProject(cwd, { dir: targetDir, silent: true }, versions, runners);
    assertProjectLifecycleCurrent(targetDir, versions);
    return emitResult({
      ...refreshed,
      managed: true,
      synchronizedFiles,
      nextSteps: ['pnpm install', `cargo update -p nimi-shell-tauri --precise ${versions.nimiShellTauriVersion}`, 'nimi-app sync', 'nimi-app check'],
    }, options, `sync completed for ${targetDir}`);
  }
  const plan = managed ? null : buildExistingSubmittedAppSyncPlan(targetDir, versions);
  const nimicoding = runNimicodingSync(targetDir, 'apply', runners);
  const synchronizedFiles = applySyncPlan(targetDir, plan);
  validateAppProject(cwd, { dir: targetDir, silent: true }, versions, runners);
  assertProjectLifecycleCurrent(targetDir, versions);
  return emitResult({
    ok: true,
    command: 'sync',
    dir: targetDir,
    managed,
    appId: plan?.descriptor.appId || readSubmittedManifest(targetDir).appId,
    synchronizedFiles,
    nimicodingSync: nimicoding?.summary || null,
    nextSteps: ['pnpm install', `cargo update -p nimi-shell-tauri --precise ${versions.nimiShellTauriVersion}`, 'nimi-app sync', 'nimi-app check'],
  }, options, `sync completed for ${targetDir}`);
}

export function checkAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  if (options.production === true) {
    throw new Error('installed_app_carrier_not_implemented');
  }
  if (options.conformance) {
    return validateAppProject(cwd, { dir: targetDir, conformance: options.conformance, json: options.json }, versions, runners);
  }
  assertNoRetiredScaffoldState(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  const validation = validateAppProject(cwd, { dir: targetDir, silent: true }, versions, runners);
  let nimicoding = null;
  if (!managed) nimicoding = runNimicodingSync(targetDir, 'check', runners);
  const { descriptor, buildProfile } = assertProjectLifecycleCurrent(targetDir, versions, { requireInstalledLock: true });
  return emitResult({
    ok: true,
    command: 'check',
    dir: targetDir,
    managed,
    appId: descriptor.appId,
    profile: descriptor.profile,
    targets: Object.keys(buildProfile.targets).sort(),
    checkedManagedFiles: validation.checkedManagedFiles,
    checkedExistingFiles: validation.checkedExistingFiles,
    nimicodingSync: nimicoding?.summary || null,
  }, options, `check passed for ${targetDir}`);
}

export function testAppProject(cwd, options = {}, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const profile = readBuildProfile(targetDir);
  const result = runOwnerCommand(targetDir, 'test', profile.testCommand, options, runners);
  return emitResult({
    ok: true,
    command: 'test',
    dir: targetDir,
    ownerCommand: profile.testCommand,
    ...(options.json ? { stdout: result.stdout || '', stderr: result.stderr || '' } : {}),
  }, options, `test passed for ${targetDir}`);
}

export function buildAppProject(cwd, options = {}, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const profile = readBuildProfile(targetDir);
  const selected = selectBuildOwner(profile, options.target);
  const result = runOwnerCommand(targetDir, 'build', selected.command, options, runners);
  if (options.production === true) {
    if (selected.target !== 'windows-x86_64' || typeof runners?.signWindowsTarget !== 'function') {
      throw new Error(`Production signing is unavailable for target: ${selected.target}`);
    }
    runners.signWindowsTarget(targetDir, resolveProductionSignTarget(targetDir, selected));
  }
  return emitResult({
    ok: true,
    command: 'build',
    dir: targetDir,
    target: selected.target,
    ownerCommand: selected.command,
    ...(options.json ? { stdout: result.stdout || '', stderr: result.stderr || '' } : {}),
  }, options, `build completed for ${selected.target}`);
}
