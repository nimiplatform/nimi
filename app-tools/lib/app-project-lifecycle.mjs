import { assertDesktopHostSupport } from './app-host-support.mjs';
import { hostedWebIdentity, isAppId } from './app-identifiers.mjs';
import { readWebDevelopment } from './web-development.mjs';
import { readAppInfo } from './app-info.mjs';
import { CANONICAL_CAPABILITY_IDS } from './canonical-capability-ids.generated.mjs';
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-009b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043a

import { existsSync, globSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { satisfies, validRange } from 'semver';
import { lockedRegistryVersion, planToolchainUpdates } from './app-toolchain-updates.mjs';
import { parse as parseYaml, parseDocument as parseYamlDocument, stringify as stringifyYaml } from 'yaml';

import { assertManifestAppAccessDeclaration } from './app-access-declaration.mjs';
import { appToolsDeclaration, defaultDependencyCombination, isLocalDependencySpec, resolveDependencyCombination } from './app-dependency-combinations.mjs';
import { SAFETY_PROFILE_FIELD, normalizeSafetyProfile } from './app-safety-profile.mjs';
import { planManagedAppSync, validateAppProject, validateAppProjectInputs, validateManagedAppFiles } from './app-doctor-update.mjs';
import { LIFECYCLE_SKILL_PATH, hasLifecycleGuidanceOwner, lifecycleOwnerSteps, planLifecycleGuidance } from './app-lifecycle-guidance.mjs';
import { applyProjectFiles, describeChanges, plannedFile } from './app-project-files.mjs';
import {
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_LOCK_PATH,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  hashScaffoldContent,
  managedAppReleaseWorkflowSource,
  renderAppBuildProfile,
  renderAppIdentityInput,
  renderAppSubmissionInput,
  renderScaffoldBoundary,
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
  '@nimiplatform/sdk-adapter-vercel-ai',
  ...KIT_OWNED_NATIVE_CARRIERS,
]);
const BUILD_PROFILE_PATH = '.nimi/config/build-profile.yaml';
const ELECTRON_BUILD_PROFILE_REF = 'electron-packager-pnpm-vite';
const APP_OWNED_ELECTRON_BUILD_PROFILE_REF = 'electron-pnpm';
const SUPPORTED_BUILD_PROFILE_REFS = new Set([ELECTRON_BUILD_PROFILE_REF, APP_OWNED_ELECTRON_BUILD_PROFILE_REF, 'web-pnpm']);
const MANAGED_WORKFLOW_PATH = '.github/workflows/nimi-app-release.yml';
const HOSTED_WEB_WORKFLOW_PATH = '.github/workflows/nimi-web-release.yml';
function hostedWorkflowSource() {
  return readFileSync(new URL('../templates/hosted-web-release.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

function planHostedWorkflow(targetDir) {
  const file = plannedFile(targetDir, HOSTED_WEB_WORKFLOW_PATH, hostedWorkflowSource());
  const previous = file.previous?.toString('utf8').replaceAll('\r\n', '\n');
  // Apps initialized with the published rc.9 template can upgrade through normal sync.
  if (previous !== undefined && previous !== file.content &&
      hashScaffoldContent(previous) !== 'c80010a26c4ed010807ec67e79083d04f8ed4345753e7d0bb12e3fe333c3f241') // pragma: allowlist secret -- SHA-256 of the public rc.9 hosted workflow
    throw new Error('Unknown hosted Web workflow collision: ' + HOSTED_WEB_WORKFLOW_PATH);
  return file;
}
const APP_IDENTITY_PATH = '.nimi/config/app-identity.yaml';
const SUBMISSION_PATH = '.nimi/admission/submission.yaml';
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const CURRENT_APP_TARGETS = Object.freeze({
  'windows-x86_64': Object.freeze({ os: 'windows', arch: 'x86_64' }),
  'macos-aarch64': Object.freeze({ os: 'macos', arch: 'arm64' }),
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

function hasProjectFile(targetDir, relativePath, sources) {
  return sources?.has(relativePath) ? sources.get(relativePath) !== null : existsSync(path.join(targetDir, relativePath));
}

function readProjectText(targetDir, relativePath, sources) {
  return sources?.has(relativePath)
    ? Buffer.from(sources.get(relativePath)).toString('utf8')
    : readFileSync(path.join(targetDir, relativePath), 'utf8');
}

function readSubmittedManifest(targetDir, sources) {
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  if (!hasProjectFile(targetDir, 'nimi.app.yaml', sources)) {
    throw new Error('Existing submitted app requires nimi.app.yaml');
  }
  const source = readProjectText(targetDir, 'nimi.app.yaml', sources);
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
    || !isAppId(appId)
    || !SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)
  ) {
    throw new Error('Existing submitted app requires canonical app_id and supported profile');
  }
  if (document?.manifest_role !== 'submitted-input') {
    throw new Error('Submitted manifest marker missing');
  }
  const platform = document.platform || 'desktop';
  if (!['desktop', 'web'].includes(platform)) throw new Error('Unsupported App platform.');
  const hosted = Object.hasOwn(document, 'public_slug') ? hostedWebIdentity(appId, document.public_slug) : null;
  const rendererOrigin = platform === 'web' ? (hosted?.origin ?? readWebDevelopment(document).site.origin) : document?.local_development?.electron?.renderer_origin;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(rendererOrigin);
  } catch {
    throw new Error('nimi.app.yaml local_development.electron.renderer_origin must be a canonical loopback origin');
  }
  if (
    typeof rendererOrigin !== 'string'
    || rendererOrigin.trim() !== rendererOrigin
    || (platform === 'desktop' && (parsedOrigin.protocol !== 'http:' || parsedOrigin.hostname !== '127.0.0.1' || !parsedOrigin.port))
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
  let safetyProfile;
  if (document.capability_contract_refs !== undefined) {
    canonicalInputList(document.capability_contract_refs, 'nimi.app.yaml capability_contract_refs');
  }
  if (document[SAFETY_PROFILE_FIELD] !== undefined) {
    try {
      safetyProfile = normalizeSafetyProfile(document[SAFETY_PROFILE_FIELD]);
    } catch (error) {
      throw new Error(`nimi.app.yaml ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return Object.freeze({ appId, displayName, profile, platform, version, publicSlug: hosted?.slug, rendererOrigin: parsedOrigin.origin, capabilityContractRefs: document.capability_contract_refs, requiredStandardizedFeatureRefs: document.required_standardized_feature_refs, storagePolicy: document.storage_policy, safetyProfile });
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

// The SDK/Kit pair comes from the App's resolved combination; the tool
// dependencies come from the selected tool version. Both are one judgment
// shared by manifest, lock and workflow checks.
function expectedNimiDependencies(versions, combination, packageJson) {
  return Object.freeze([
    Object.freeze({ name: '@nimiplatform/sdk', section: 'dependencies', version: combination.sdkVersion }),
    Object.freeze({ name: '@nimiplatform/kit', section: 'dependencies', version: combination.kitVersion }),
    Object.freeze({ name: '@nimiplatform/app-tools', section: 'devDependencies', version: appToolsDeclaration(packageJson.devDependencies?.['@nimiplatform/app-tools'], versions.appToolsVersion) }),
    Object.freeze({ name: '@nimiplatform/nimi-coding', section: 'devDependencies', version: versions.nimicodingVersion }),
  ]);
}

// Managed (scaffold-locked) projects derive glue, matrix and package fields
// from `versions`; `managedProjectVersions` has already pinned those to the
// project's own supported combination, so the default of the effective
// versions is that combination. Existing submitted Apps resolve theirs directly.
function selectDependencyCombination(packageJson, versions, managed) {
  return managed ? defaultDependencyCombination(versions) : resolveDependencyCombination(packageJson, versions);
}

// Validate the App's explicit SDK/Kit selection before deriving or writing
// managed glue. A previous Host contract must be upgraded by the App first;
// selecting a newer tool never silently changes business dependencies.
function managedProjectVersions(targetDir, versions) {
  const packagePath = path.join(targetDir, 'package.json');
  if (!existsSync(packagePath)) return versions;
  const pkg = readJsonFile(packagePath, 'package.json');
  const combination = resolveDependencyCombination(pkg, versions);
  const appToolsVersion = appToolsDeclaration(pkg.devDependencies?.['@nimiplatform/app-tools'], versions.appToolsVersion);
  return Object.freeze({ ...versions, ...combination, appToolsVersion });
}

function describeCombination(combination, toolVersions) {
  const dependencies = { '@nimiplatform/sdk': combination.sdkVersion, '@nimiplatform/kit': combination.kitVersion };
  const { source } = resolveDependencyCombination({ dependencies }, toolVersions);
  return { sdk: combination.sdkVersion, kit: combination.kitVersion, source };
}

function dependencySection(packageJson, sectionName) {
  const section = packageJson[sectionName];
  if (section === undefined) return null;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`package.json ${sectionName} must be an object`);
  }
  return section;
}

function localPackageArchive(value) {
  return typeof value === 'string' ? value.match(/^(file:[^\r\n]+?\.(?:tgz|tar\.gz))(?:\(.*\))?$/u)?.[1] || '' : '';
}

function archivePath(targetDir, value) {
  const archive = localPackageArchive(value);
  return archive ? path.resolve(targetDir, archive.slice('file:'.length)) : '';
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

function assertPackageManifestCurrent(packageJson, versions, combination, platform = 'desktop') {
  if (packageJson.private !== true || Object.hasOwn(packageJson, 'publishConfig')) {
    throw new Error('Nimi App package.json must be private and must not declare npm publishConfig');
  }
  if (packageJson.packageManager !== versions.packageManager) {
    throw new Error(`package.json packageManager must be ${versions.packageManager}`);
  }
  assertPublicNimiDependencySpecs(packageJson);
  for (const expected of expectedNimiDependencies(versions, combination, packageJson)) {
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
  if (platform === 'desktop' && scripts.pack !== 'nimi-app pack') {
    throw new Error('package.json scripts.pack must use the canonical nimi-app pack owner');
  }
  if (platform === 'desktop' && scripts.publish !== undefined) {
    throw new Error('package.json scripts.publish is unavailable until publisher GitHub and registry orchestration is implemented');
  }
  return combination;
}

function normalizePackageManifest(packageJson, descriptor, versions, buildProfileRef, packageSource, combination, toolchainUpdates) {
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json must contain an object');
  }
  const normalized = JSON.parse(JSON.stringify(packageJson));
  normalized.private = true;
  delete normalized.publishConfig;
  for (const { section, name, to } of toolchainUpdates) normalized[section][name] = to;
  for (const sectionName of NPM_DEPENDENCY_SECTIONS) dependencySection(normalized, sectionName);
  for (const expected of expectedNimiDependencies(versions, combination, packageJson)) {
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
  if (descriptor.platform === 'web') {
    normalized.scripts.dev = 'nimi-app dev --platform web';
    normalized.scripts.sync ||= 'nimi-app sync';
    if (normalized.scripts.pack === 'nimi-app pack') delete normalized.scripts.pack;
  } else {
  if (typeof normalized.scripts['build:electron'] !== 'string' || !normalized.scripts['build:electron'].trim()) {
    throw new Error('package.json build:electron must build the Desktop-supervised Electron host');
  }
  normalized.scripts.dev = 'nimi-app dev --shell electron';
  normalized.scripts['dev:shell'] = 'nimi-app dev';
  normalized.scripts['dev:electron'] = 'nimi-app dev --shell electron';
  if (buildProfileRef !== APP_OWNED_ELECTRON_BUILD_PROFILE_REF) {
    normalized.scripts['dev:renderer'] = `vite --host 127.0.0.1 --port ${new URL(descriptor.rendererOrigin).port} --strictPort`;
  }
  normalized.scripts.sync ||= 'nimi-app sync';
  normalized.scripts.pack = 'nimi-app pack';
  delete normalized.scripts.publish;
  }
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
  assertPackageManifestCurrent(normalized, versions, combination, descriptor.platform);
  // Project formatters may use different whitespace or key order. Only managed
  // value changes require rewriting this App-owned manifest.
  if (stableInputJson(normalized) === stableInputJson(packageJson)) return packageSource;
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
  if (label.endsWith('capability_contract_refs')) {
    for (const entry of entries) {
      if (!CANONICAL_CAPABILITY_IDS.includes(entry)) throw new Error(`${label} contains unknown CapabilityContract: ${entry}`);
    }
  }
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
    if (synchronizedNimiPackageName(key) && !localPackageArchive(overrides[key])) {
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

function assertPnpmWorkspaceCurrent(targetDir, sources, production = false) {
  const workspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
  const localPackages = new Map();
  if (!hasProjectFile(targetDir, 'pnpm-workspace.yaml', sources)) return localPackages;
  const source = readProjectText(targetDir, 'pnpm-workspace.yaml', sources);
  const workspace = parseYamlFile(source, workspacePath);
  const overrides = workspace?.overrides;
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new Error('pnpm-workspace.yaml overrides must be an object');
  }
  for (const key of Object.keys(overrides || {})) {
    const packageName = synchronizedNimiPackageName(key);
    if (packageName && localPackageArchive(overrides[key])) {
      if (production) throw new Error('Production release preflight requires registry dependencies. Remove local Nimi tarball overrides only when preparing a public release; use check without --production for local development.');
      if (key !== packageName) throw new Error(`Local Nimi tarball overrides must name the exact package: ${key}`);
      const target = archivePath(targetDir, overrides[key]);
      if (!existsSync(target) || !lstatSync(target).isFile()) throw installRequiredError(`Local Nimi package archive is missing: ${overrides[key]}`);
      localPackages.set(packageName, overrides[key]);
    } else if (packageName) {
      throw installRequiredError(`pnpm-workspace.yaml retains a Nimi dependency override: ${key}`);
    }
  }
  return localPackages;
}

function findLocalNimiResolution(value, currentPackage = '', pathParts = [], allowedArchive = () => false) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = findLocalNimiResolution(value[index], currentPackage, [...pathParts, String(index)], allowedArchive);
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
      && !allowedArchive(packageName, normalizedKey.slice(packageName.length + 1), [...pathParts, key])
    ) {
      return [...pathParts, key].join('.');
    }
    if (packageName && typeof child === 'string' && isLocalDependencySpec(child) && !allowedArchive(packageName, child, [...pathParts, key])) {
      return [...pathParts, key].join('.');
    }
    const finding = findLocalNimiResolution(child, packageName, [...pathParts, key], allowedArchive);
    if (finding) return finding;
  }
  return null;
}

function readInstalledPnpmLock(targetDir) {
  const modulesPath = path.join(targetDir, 'node_modules', '.modules.yaml');
  if (!existsSync(modulesPath)) throw installRequiredError('pnpm installation metadata is missing');
  const modules = parseYamlFile(readFileSync(modulesPath, 'utf8'), modulesPath);
  if (typeof modules?.virtualStoreDir !== 'string' || !modules.virtualStoreDir.trim()) {
    throw installRequiredError('pnpm installation has no virtual store');
  }
  const installedLockPath = path.join(path.resolve(targetDir, 'node_modules', modules.virtualStoreDir), 'lock.yaml');
  if (!existsSync(installedLockPath)) throw installRequiredError('pnpm installed dependency lock is missing');
  return parseYamlFile(readFileSync(installedLockPath, 'utf8'), installedLockPath);
}

function selectedLocalPackageRecord(lock, name, selected, targetDir) {
  const matches = Object.entries(lock?.packages || {}).filter(([key, entry]) =>
    key.startsWith(name + '@') && archivePath(targetDir, entry?.resolution?.tarball) === archivePath(targetDir, selected));
  if (matches.length !== 1 || typeof matches[0][1]?.version !== 'string'
    || typeof matches[0][1]?.resolution?.integrity !== 'string' || !matches[0][1].resolution.integrity) {
    throw installRequiredError(`Local Nimi package installation is stale or has no complete locked tarball resolution: ${name}`);
  }
  return matches[0][1];
}

function assertPnpmLockCurrent(targetDir, packageJson, localPackages, versions, combination) {
  const lockPath = path.join(targetDir, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    throw installRequiredError('pnpm-lock.yaml is missing');
  }
  const lock = parseYamlFile(readFileSync(lockPath, 'utf8'), lockPath);
  const allowedArchive = (name, value, location = []) => {
    // pnpm rebases importer specifiers to the member directory; resolved
    // versions and package/snapshot keys stay relative to the workspace root.
    let base = targetDir;
    if (location.length === 5 && location[0] === 'importers'
      && NPM_DEPENDENCY_SECTIONS.includes(location[2]) && location[4] === 'specifier') {
      base = path.resolve(targetDir, location[1]);
      const relative = path.relative(targetDir, base);
      if (path.isAbsolute(location[1]) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw installRequiredError(`pnpm-lock.yaml importer is outside the App workspace: ${location[1]}`);
      }
    }
    return localPackageArchive(value) && localPackages.has(name)
      && archivePath(base, value) === archivePath(targetDir, localPackages.get(name));
  };
  const finding = findLocalNimiResolution(lock, '', [], allowedArchive);
  if (finding) {
    throw installRequiredError(`pnpm-lock.yaml retains a local Nimi resolution at ${finding}`);
  }
  const importer = lock?.importers?.['.'];
  if (!importer || typeof importer !== 'object' || Array.isArray(importer)) {
    throw installRequiredError('pnpm-lock.yaml root importer is missing');
  }
  for (const update of planToolchainUpdates(packageJson, importer, versions)) {
    if (update.lockedAffected) throw installRequiredError(`pnpm-lock.yaml resolves ${update.name}@${update.locked}. Select a patched release (fixed in ${update.fixedVersion})`);
  }
  const requiredPackages = expectedNimiDependencies(versions, combination, packageJson);
  const installedLock = localPackages.size > 0 ? readInstalledPnpmLock(targetDir) : null;
  for (const [name, selected] of localPackages) {
    if (lock.overrides?.[name] !== selected) throw installRequiredError(`pnpm-lock.yaml local package override does not match pnpm-workspace.yaml: ${name}`);
    let manifestPath = path.join(targetDir, 'node_modules', ...name.split('/'), 'package.json');
    if (KIT_OWNED_NATIVE_CARRIERS.includes(name)) {
      try {
        const kitManifest = realpathSync(path.join(targetDir, 'node_modules', '@nimiplatform', 'kit', 'package.json'));
        manifestPath = createRequire(kitManifest).resolve(name + '/package.json');
      } catch {
        throw installRequiredError(`Local Nimi native package is not installed for Kit: ${name}`);
      }
    }
    if (!existsSync(manifestPath)) throw installRequiredError(`Local Nimi package is not installed: ${name}`);
    const installed = readJsonFile(manifestPath, name);
    const declared = NPM_DEPENDENCY_SECTIONS.map((section) => dependencySection(packageJson, section)?.[name]).filter((value) => value !== undefined);
    const expected = requiredPackages.find((entry) => entry.name === name)?.version
      || (KIT_OWNED_NATIVE_CARRIERS.includes(name) ? combination.kitVersion : declared[0]);
    if (!expected || declared.some((specifier) => specifier !== expected)) {
      throw installRequiredError(`Local Nimi package has no consistent declared version: ${name}`);
    }
    if (installed.name !== name || !satisfies(installed.version, expected, { includePrerelease: true })) {
      throw installRequiredError(`Installed local Nimi package must be ${name}@${expected}`);
    }
    if (archivePath(targetDir, installedLock?.overrides?.[name]) !== archivePath(targetDir, selected)) {
      throw installRequiredError(`Local Nimi package installation is stale: ${name}`);
    }
    const locked = selectedLocalPackageRecord(lock, name, selected, targetDir);
    const installedResolution = selectedLocalPackageRecord(installedLock, name, selected, targetDir);
    if (installed.version !== locked.version || installedResolution.version !== locked.version
      || installedResolution.resolution.integrity !== locked.resolution.integrity) {
      throw installRequiredError(`Local Nimi package installation is stale: ${name}`);
    }
  }
  for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
    const packageSection = dependencySection(packageJson, sectionName) || {};
    const lockSection = importer[sectionName] || {};
    for (const [name, specifier] of Object.entries(packageSection)) {
      if ((name === 'vite' || name === 'electron') && sectionName !== 'peerDependencies' && validRange(specifier)) {
        const entry = lockSection[name];
        if (typeof entry?.specifier !== 'string' || (entry.specifier !== specifier && entry.specifier !== lock.overrides?.[name])
          || !satisfies(lockedRegistryVersion(entry), specifier)) {
          throw installRequiredError(`pnpm-lock.yaml ${sectionName}.${name} does not resolve the declared range ${specifier}`);
        }
      }
      if (!name.startsWith('@nimiplatform/')) continue;
      if (lockSection?.[name]?.specifier !== (localPackages.get(name) || specifier)) {
        throw installRequiredError(`pnpm-lock.yaml ${sectionName}.${name} specifier does not match package.json`);
      }
      if (!localPackages.has(name) && requiredPackages.some(dep => dep.name === name)
        && !satisfies(lockedRegistryVersion(lockSection[name]), specifier)) {
        throw installRequiredError(`pnpm-lock.yaml ${sectionName}.${name} does not resolve the declared range ${specifier}`);
      }
      if (localPackages.has(name)
        && installedLock?.importers?.['.']?.[sectionName]?.[name]?.version !== lockSection[name]?.version) {
        throw installRequiredError(`Local Nimi package installation is stale: ${name}`);
      }
    }
    for (const name of Object.keys(lockSection || {})) {
      if (name.startsWith('@nimiplatform/') && !Object.hasOwn(packageSection, name)) {
        throw installRequiredError(`pnpm-lock.yaml retains stale Nimi dependency: ${sectionName}.${name}`);
      }
    }
  }
  for (const [importerName, child] of Object.entries(lock.importers)) {
    if (importerName === '.') continue;
    for (const sectionName of NPM_DEPENDENCY_SECTIONS) {
      for (const [name, dependency] of Object.entries(child?.[sectionName] || {})) {
        if (!localPackages.has(name)) continue;
        const location = ['importers', importerName, sectionName, name, 'specifier'];
        const installed = installedLock?.importers?.[importerName]?.[sectionName]?.[name];
        if (typeof dependency?.version !== 'string' || installed?.version !== dependency.version
          || !allowedArchive(name, dependency?.specifier, location)
          || !allowedArchive(name, installed?.specifier, location)) {
          throw installRequiredError(`Local Nimi package installation is stale: importers.${importerName}.${sectionName}.${name}`);
        }
      }
    }
  }
}

function normalizeStandaloneSourceFiles(targetDir, sources) {
  const planned = [];
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    const filePath = path.join(targetDir, name);
    if (!hasProjectFile(targetDir, name, sources)) continue;
    const previous = readProjectText(targetDir, name, sources);
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
  if (hasProjectFile(targetDir, 'src/styles.css', sources)) {
    const previous = readProjectText(targetDir, 'src/styles.css', sources);
    const content = previous.replace(
      /^@source\s+["'][^"']*\/nimi\/kit\/\*\*\/\*\.\{ts,tsx\}["'];?\r?$/gmu,
      '@source "../node_modules/@nimiplatform/kit/**/*.{js,mjs,ts,tsx}";',
    );
    planned.push({ path: stylesPath, content, previous });
  }
  return planned;
}

function assertNoStandaloneParentSources(targetDir, sources) {
  for (const relativePath of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'src/styles.css']) {
    const filePath = path.join(targetDir, ...relativePath.split('/'));
    if (!hasProjectFile(targetDir, relativePath, sources)) continue;
    const source = readProjectText(targetDir, relativePath, sources);
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

function cargoPackageNameFromNpmPackageName(packageName) {
  const normalized = String(packageName || '')
    .trim()
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/\//gu, '-')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!normalized) throw new Error('package.json name must produce a canonical cargo_package_name');
  return `${normalized}-shell`;
}

function tauriIdentifierFromAppId(appId) {
  return `ai.nimi.apps.${appId}`;
}

function readProjectLifecycleFiles(targetDir, sources) {
  const packagePath = path.join(targetDir, 'package.json');
  if (!existsSync(packagePath)) throw new Error('Required App lifecycle file is missing: package.json');
  const packageSource = readProjectText(targetDir, 'package.json', sources);
  return {
    packagePath,
    packageSource,
    packageJson: JSON.parse(packageSource),
  };
}

function assertVersionLockstep(files, descriptor) {
  const version = files.packageJson.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('package.json version must be an exact semantic version');
  }
  if (descriptor.version != null && descriptor.version !== version) {
    throw new Error(`nimi.app.yaml version must match package.json version ${version}`);
  }
  return version;
}

function assertCanonicalAuthoringInputs(targetDir, descriptor, files, version, nativeIdentity, sources) {
  const identityPath = path.join(targetDir, APP_IDENTITY_PATH);
  const submissionPath = path.join(targetDir, SUBMISSION_PATH);
  if (!hasProjectFile(targetDir, APP_IDENTITY_PATH, sources)) throw new Error(`Required App lifecycle file is missing: ${APP_IDENTITY_PATH}`);
  if (!hasProjectFile(targetDir, SUBMISSION_PATH, sources)) throw new Error(`Required App lifecycle file is missing: ${SUBMISSION_PATH}`);
  const identity = assertExactKeys(parseYamlFile(readProjectText(targetDir, APP_IDENTITY_PATH, sources), identityPath), APP_IDENTITY_PATH, [
    'app_id', 'display_name', 'version', 'npm_package_name', 'cargo_package_name', 'tauri_identifier', 'package_author', 'identity_role',
  ]);
  const packageAuthor = files.packageJson.author === undefined ? null : files.packageJson.author;
  if (packageAuthor !== null) canonicalInputText(packageAuthor, 'package.json author');
  const expectedIdentity = {
    app_id: descriptor.appId,
    display_name: descriptor.displayName,
    version,
    npm_package_name: canonicalInputText(files.packageJson.name, 'package.json name'),
    cargo_package_name: nativeIdentity.cargoPackageName,
    tauri_identifier: nativeIdentity.tauriIdentifier,
    package_author: packageAuthor,
    identity_role: 'scaffold-generated-authoring-input',
  };
  for (const [key, expected] of Object.entries(expectedIdentity)) {
    if (identity[key] !== expected) throw new Error(`${APP_IDENTITY_PATH} ${key} must match its canonical owner`);
  }

  const submission = assertExactKeys(parseYamlFile(readProjectText(targetDir, SUBMISSION_PATH, sources), submissionPath), SUBMISSION_PATH, [
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
  ], ['ai_profile_recommendation_ref', SAFETY_PROFILE_FIELD, 'platform']);
  const expectedSubmissionIdentity = {
    app_id: descriptor.appId,
    display_name: descriptor.displayName,
    version,
    profile: descriptor.profile,
    ...(descriptor.platform === 'web' ? { platform: 'web' } : {}),
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
  // nimi.app.yaml is the only declaration author; the submission copy must be
  // the tool projection of it, never an independently edited second source.
  if (JSON.stringify(submission[SAFETY_PROFILE_FIELD]) !== JSON.stringify(descriptor.safetyProfile)) {
    throw new Error(`${SUBMISSION_PATH} ${SAFETY_PROFILE_FIELD} must match the nimi.app.yaml declaration; run nimi-app sync to project it`);
  }
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

function isScopedComponentReleaseWorkflow(source, targetDir) {
  // A separate, non-latest component tag with matching bounded asset names is
  // not the App release. Unclassified releases still require owner review.
  if (/candidate-uploads|\/api\/platform\/apps\/candidates|\.nimiapp\b|\bnimi-app\s+(?:build|pack)\b|\belectron-builder\b|\btauri\s+build\b/iu.test(source)
    || /\bgh\s+release\s+(?:create|upload|edit|delete)\b/iu.test(source)) return false;
  const packageJson = JSON.parse(readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
  const inspectedScripts = new Set();
  const invokesAppBuild = command => {
    if (/\bnimi-app\s+(?:build|pack)\b|\belectron-builder\b|\btauri\s+build\b/u.test(command)) return true;
    for (const match of command.matchAll(/\b(?:npm|pnpm)\s+(?:run\s+)?([\w:-]+)/gu)) {
      if (inspectedScripts.has(match[1])) continue;
      inspectedScripts.add(match[1]);
      const script = packageJson.scripts?.[match[1]];
      if (script && invokesAppBuild(script)) return true;
    }
    return false;
  };
  if (invokesAppBuild(source)) return false;
  let workflow;
  try { workflow = parseYaml(source); } catch { return false; }
  const releaseSteps = Object.values(workflow?.jobs ?? {}).flatMap(job => job?.steps ?? [])
    .filter(step => /(?:softprops\/action-gh-release|ncipollo\/release-action|actions\/create-release)/iu.test(String(step?.uses ?? '')));
  if (releaseSteps.length === 0) return false;
  return releaseSteps.every(step => {
    if (!/^softprops\/action-gh-release@/u.test(String(step.uses)) || step.with?.make_latest !== false) return false;
    const tag = String(step.with?.tag_name ?? '');
    const prefix = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)-v(?=\$\{\{|\d)/u.exec(tag)?.[1];
    if (!prefix || prefix === packageJson.name || prefix === packageJson.name?.replace(/^@[^/]+\//u, '')) return false;
    const files = typeof step.with?.files === 'string' ? step.with.files.trim().split(/\r?\n/u) : [];
    return files.length > 0 && files.every(file => (
      (file.startsWith(`${prefix}-`) || file.startsWith(`${prefix}.`))
      && !/[\\/]/u.test(file) && !file.includes('..')
      && /\.(?:zip|tar\.gz|exe|dll|node|\*)$/u.test(file)
    ));
  });
}

function assertManagedWorkflowCurrent(targetDir, sources, hosted) {
  const workflowPath = path.join(targetDir, MANAGED_WORKFLOW_PATH);
  if (!hasProjectFile(targetDir, MANAGED_WORKFLOW_PATH, sources)) throw new Error(`Required App lifecycle file is missing: ${MANAGED_WORKFLOW_PATH}`);
  if (readProjectText(targetDir, MANAGED_WORKFLOW_PATH, sources) !== managedAppReleaseWorkflowSource()) {
    throw new Error(`${MANAGED_WORKFLOW_PATH} must match the app-tools managed workflow`);
  }
  const workflowDir = path.dirname(workflowPath);
  for (const name of existsSync(workflowDir) ? readdirSync(workflowDir).sort() : []) {
    const candidatePath = path.join(workflowDir, name);
    if (candidatePath === workflowPath || !/\.ya?ml$/iu.test(name)) continue;
    if (hosted && name === 'nimi-web-release.yml') continue;
    const source = readFileSync(candidatePath, 'utf8');
    if (!isScopedComponentReleaseWorkflow(source, targetDir) && (
      /\bgh\s+release\s+(?:create|upload|edit|delete)\b/iu.test(source)
      || /(?:softprops\/action-gh-release|ncipollo\/release-action|actions\/create-release)/iu.test(source)
      || /candidate-uploads|\/api\/platform\/apps\/candidates/iu.test(source)
    )) {
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

function readBuildProfile(targetDir, sources) {
  const filePath = path.join(targetDir, BUILD_PROFILE_PATH);
  if (!hasProjectFile(targetDir, BUILD_PROFILE_PATH, sources)) throw new Error(`Required App lifecycle file is missing: ${BUILD_PROFILE_PATH}`);
  const profile = parseYamlFile(readProjectText(targetDir, BUILD_PROFILE_PATH, sources), filePath);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`${BUILD_PROFILE_PATH} must contain an object`);
  }
  if (profile.profile_role !== 'developer-workflow-input') {
    throw new Error(`${BUILD_PROFILE_PATH} profile_role must be developer-workflow-input`);
  }
  const buildProfileRef = typeof profile.build_profile_ref === 'string'
    ? profile.build_profile_ref
    : '';
  assertDesktopHostSupport(buildProfileRef);
  if (!SUPPORTED_BUILD_PROFILE_REFS.has(buildProfileRef)) {
    throw new Error(`${BUILD_PROFILE_PATH} build_profile_ref is unsupported: ${String(profile.build_profile_ref)}`);
  }
  const targets = profile.targets === undefined ? {} : profile.targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    throw new Error(`${BUILD_PROFILE_PATH} targets must be an object`);
  }
  if (Object.keys(targets).length === 0) {
    throw new Error(`${BUILD_PROFILE_PATH} must declare at least one target`);
  }
  for (const [targetId, target] of Object.entries(targets)) {
    const expected = buildProfileRef === 'web-pnpm' ? (targetId === 'web' ? {} : null) : CURRENT_APP_TARGETS[targetId];
    if (!expected || !target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error(`${BUILD_PROFILE_PATH} declares unsupported target: ${targetId}`);
    }
    if (buildProfileRef !== 'web-pnpm' && (target.os !== expected.os || target.arch !== expected.arch)) {
      throw new Error(`${BUILD_PROFILE_PATH} target identity mismatch: ${targetId}`);
    }
  }
  return {
    buildProfileRef,
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
  const target = String(requestedTarget || '').trim() || (profile.buildProfileRef === 'web-pnpm' ? 'web' : currentTargetId());
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

function assertBuiltRuntimeEntry(targetDir, selected) {
  const projectRoot = path.resolve(targetDir);
  const payloadPath = path.resolve(projectRoot, ...selected.payloadPath.split('/'));
  const projectPrefix = `${projectRoot}${path.sep}`;
  if (!payloadPath.startsWith(projectPrefix) || !existsSync(payloadPath)) {
    throw new Error(`Build payload is missing or noncanonical: ${selected.payloadPath}`);
  }
  const payloadStat = lstatSync(payloadPath);
  let runtimeTarget = payloadPath;
  if (payloadStat.isDirectory()) {
    const runtimeRelative = selected.runtimeEntry.slice('payload/'.length);
    runtimeTarget = path.resolve(payloadPath, ...runtimeRelative.split('/'));
  } else if (payloadStat.isFile() && selected.runtimeEntry !== `payload/${path.basename(payloadPath)}`) {
    throw new Error(`Build Runtime entry does not select the direct payload file: ${selected.runtimeEntry}`);
  } else if (!payloadStat.isFile() || payloadStat.isSymbolicLink()) {
    throw new Error(`Build payload is not a direct file or directory: ${selected.payloadPath}`);
  }
  const payloadPrefix = `${payloadPath}${path.sep}`;
  if (
    !existsSync(runtimeTarget)
    || (!payloadStat.isFile() && !runtimeTarget.startsWith(payloadPrefix))
  ) {
    throw new Error(`Build Runtime entry is missing or noncanonical: ${selected.runtimeEntry}`);
  }
  const runtimeTargetStat = lstatSync(runtimeTarget);
  if (!runtimeTargetStat.isFile() || runtimeTargetStat.isSymbolicLink()) {
    throw new Error(`Build Runtime entry must be a direct regular file: ${selected.runtimeEntry}`);
  }
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
  const sources = options.sources;
  const descriptor = readSubmittedManifest(targetDir, sources);
  const buildProfile = readBuildProfile(targetDir, sources);
  if ((descriptor.platform === 'web') !== (buildProfile.buildProfileRef === 'web-pnpm')) throw new Error('Manifest platform and build owner disagree.');
  const files = readProjectLifecycleFiles(targetDir, sources);
  const combination = selectDependencyCombination(files.packageJson, versions, options.managed === true);
  assertPackageManifestCurrent(files.packageJson, versions, combination, descriptor.platform);
  const version = assertVersionLockstep(files, descriptor);
  const nativeIdentity = {
    cargoPackageName: cargoPackageNameFromNpmPackageName(files.packageJson.name),
    tauriIdentifier: tauriIdentifierFromAppId(descriptor.appId),
  };
  assertNoStandaloneParentSources(targetDir, sources);
  const authoring = assertCanonicalAuthoringInputs(targetDir, descriptor, files, version, nativeIdentity, sources);
  if (descriptor.publicSlug && (!hasProjectFile(targetDir, HOSTED_WEB_WORKFLOW_PATH, sources) || readProjectText(targetDir, HOSTED_WEB_WORKFLOW_PATH, sources).replaceAll('\r\n', '\n') !== hostedWorkflowSource())) {
    throw new Error('The hosted Web workflow must match App Tools. Use nimi-app sync to install its reviewed template.');
  }
  if (descriptor.platform !== 'web') assertManagedWorkflowCurrent(targetDir, sources, Boolean(descriptor.publicSlug));
  const localPackages = assertPnpmWorkspaceCurrent(targetDir, sources, options.production === true);
  if (options.requireInstalledLock === true) {
    assertPnpmLockCurrent(targetDir, files.packageJson, localPackages, versions, combination);
  }
  return { descriptor, files, version, buildProfile, authoring, combination };
}

function buildExistingSubmittedAppSyncPlan(targetDir, versions, sources, managed = false) {
  const descriptor = readSubmittedManifest(targetDir, sources);
  const buildProfile = readBuildProfile(targetDir, sources);
  if ((descriptor.platform === 'web') !== (buildProfile.buildProfileRef === 'web-pnpm')) throw new Error('Manifest platform and build owner disagree.');
  const files = readProjectLifecycleFiles(targetDir, sources);
  const version = files.packageJson.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('package.json version must be an exact semantic version before sync');
  }
  const combination = selectDependencyCombination(files.packageJson, versions, managed);
  const lockPath = path.join(targetDir, 'pnpm-lock.yaml');
  const importer = existsSync(lockPath) ? parseYamlFile(readFileSync(lockPath, 'utf8'), lockPath)?.importers?.['.'] : null;
  const toolchainUpdates = planToolchainUpdates(files.packageJson, importer, versions);
  const identity = {
    appId: descriptor.appId,
    appTitle: descriptor.displayName,
    version,
    profile: descriptor.profile,
    ...(descriptor.platform === 'web' ? { platform: 'web' } : {}),
    packageName: files.packageJson.name,
    cargoPackageName: cargoPackageNameFromNpmPackageName(files.packageJson.name),
    tauriIdentifier: tauriIdentifierFromAppId(descriptor.appId),
    author: typeof files.packageJson.author === 'string' ? files.packageJson.author : '',
  };
  const planned = [
    { path: files.packagePath, content: normalizePackageManifest(files.packageJson, descriptor, versions, buildProfile.buildProfileRef, files.packageSource, combination, toolchainUpdates), previous: files.packageSource },
  ];
  planned.push(...normalizeStandaloneSourceFiles(targetDir, sources));
  const identityPath = path.join(targetDir, APP_IDENTITY_PATH);
  planned.push({
    path: identityPath,
    content: renderAppIdentityInput(identity),
    previous: existsSync(identityPath) ? readFileSync(identityPath, 'utf8') : '',
  });
  const submissionPath = path.join(targetDir, SUBMISSION_PATH);
  const currentSubmissionSource = hasProjectFile(targetDir, SUBMISSION_PATH, sources) ? readProjectText(targetDir, SUBMISSION_PATH, sources) : '';
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
    ], ['ai_profile_recommendation_ref', SAFETY_PROFILE_FIELD, 'platform']);
    canonicalInputList(currentSubmission.capability_contract_refs, `${SUBMISSION_PATH} capability_contract_refs`);
    canonicalInputList(currentSubmission.required_standardized_feature_refs, `${SUBMISSION_PATH} required_standardized_feature_refs`);
    normalizeStorageInput(currentSubmission.storage_policy, `${SUBMISSION_PATH} storage_policy`);
    supportManifest = normalizeSupportInput(currentSubmission.support_manifest, `${SUBMISSION_PATH} support_manifest`);
  }
  const submissionContent = renderAppSubmissionInput(identity, {
    capabilityContractRefs: descriptor.capabilityContractRefs ?? currentSubmission?.capability_contract_refs ?? [],
    requiredStandardizedFeatureRefs: descriptor.requiredStandardizedFeatureRefs ?? currentSubmission?.required_standardized_feature_refs ?? [],
    aiProfileRecommendationRef: currentSubmission?.ai_profile_recommendation_ref,
    storagePolicy: descriptor.storagePolicy ?? currentSubmission?.storage_policy ?? { kind: 'nimi-mediated-default' },
    safetyProfile: descriptor.safetyProfile,
    supportManifest,
  });
  planned.push({ path: submissionPath, content: submissionContent, previous: currentSubmissionSource });
  const buildProfilePath = path.join(targetDir, BUILD_PROFILE_PATH);
  const currentBuildProfile = hasProjectFile(targetDir, BUILD_PROFILE_PATH, sources) ? readProjectText(targetDir, BUILD_PROFILE_PATH, sources) : '';
  const buildProfileInput = currentBuildProfile
    ? parseYamlFile(currentBuildProfile, buildProfilePath)
    : {};
  const scripts = files.packageJson.scripts || {};
  const testCommand = buildProfileInput.test_command
    || (typeof scripts['test:app'] === 'string' ? 'pnpm run test:app' : null)
    || (typeof scripts.test === 'string' && !/\bnimi-app\s+test\b/u.test(scripts.test) ? 'pnpm run test' : null);
  const buildCommand = buildProfileInput.build_command
    || (typeof scripts['build:shell'] === 'string' ? 'pnpm run build:shell' : null)
    || (typeof scripts.build === 'string' && !/\bnimi-app\s+build\b/u.test(scripts.build) ? 'pnpm run build' : null);
  if (!testCommand || !buildCommand) {
    throw new Error('Existing submitted App requires declared test and build owner commands');
  }
  const normalizedBuildProfile = currentBuildProfile
    ? stringifyYaml({
      ...buildProfileInput,
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
  if (descriptor.platform !== 'web') {
    const workflowPath = path.join(targetDir, MANAGED_WORKFLOW_PATH);
    planned.push({
      path: workflowPath,
      content: managedAppReleaseWorkflowSource(),
      previous: existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '',
    });
  }
  if (descriptor.publicSlug) planned.push(planHostedWorkflow(targetDir));
  const workspace = normalizePnpmWorkspace(targetDir);
  if (workspace) planned.push(workspace);
  return { descriptor, planned: planned.map((file) => plannedFile(targetDir, path.relative(targetDir, file.path), file.content)), buildProfileRef: buildProfile.buildProfileRef, combination, toolchainUpdates, packageJson: files.packageJson };
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

function planSources(targetDir, planned) {
  return new Map(planned.map((file) => [path.relative(targetDir, file.path).split(path.sep).join('/'), file.content]));
}

function validateProjectPlan(targetDir, versions, planned, managed) {
  const sources = planSources(targetDir, planned);
  const current = assertProjectLifecycleCurrent(targetDir, versions, { sources, managed });
  for (const target of Object.keys(current.buildProfile.targets)) selectBuildOwner(current.buildProfile, target);
  validateAppProjectInputs(targetDir, parseYaml(readProjectText(targetDir, 'nimi.app.yaml', sources)), current.files.packageJson, managed, sources);
  return current;
}

export function validateAppInitialization(targetDir, versions) {
  const effective = managedProjectVersions(targetDir, versions);
  const planned = readSubmittedManifest(targetDir).publicSlug ? [planHostedWorkflow(targetDir)] : [];
  const current = assertProjectLifecycleCurrent(targetDir, effective, { managed: true, sources: planSources(targetDir, planned) });
  for (const target of Object.keys(current.buildProfile.targets)) selectBuildOwner(current.buildProfile, target);
  return planned;
}

function ownershipHandoverMessage(handover) {
  if (handover.path.startsWith('src-tauri/')) return `${handover.path} leaves scaffold management (${handover.file}).`;
  if (handover.file === 'missing') {
    return `${handover.path} now belongs to the App and is missing; add the App's own ${handover.path} before packaging.`;
  }
  const kept = `${handover.path} now belongs to the App; sync keeps it unchanged and will not rewrite it.`;
  return handover.earlierScaffoldContent
    ? `${kept} It still holds the text the earlier scaffold wrote: replace it with the App's own license and copyright holder.`
    : kept;
}

function emitOwnershipHandovers(handovers, options) {
  if (options.json) return;
  for (const handover of handovers) process.stdout.write(`[nimi-app] ${ownershipHandoverMessage(handover)}\n`);
}

function executeProjectPlan(targetDir, options, versions, runners, plan, scaffold, toolVersions = versions) {
  if (scaffold) validateManagedAppFiles(targetDir, scaffold.snapshot.lock, planSources(targetDir, plan.planned));
  validateProjectPlan(targetDir, versions, plan.planned, Boolean(scaffold));
  const handovers = scaffold?.handovers ?? [];
  const dependencyChanges = expectedNimiDependencies(versions, plan.combination, plan.packageJson).flatMap(({ name, section, version }) => {
    const declared = plan.packageJson[section]?.[name] ?? null;
    const from = declared === version ? scaffold?.previousDependencies?.[name] ?? declared : declared;
    return from === version ? [] : [{ name, from, to: version, kind: section === 'devDependencies' ? 'tool' : 'sdk-kit' }];
  });
  const manual = plan.toolchainUpdates.filter(update => update.manual);
  const preview = {
    dependencyChanges, toolchainUpdates: plan.toolchainUpdates, readyToApply: manual.length === 0,
    ok: true, command: options.adopt ? 'init' : 'sync', dir: targetDir,
    managed: Boolean(scaffold), appId: plan.descriptor.appId,
    dryRun: options.dryRun === true, skillPath: LIFECYCLE_SKILL_PATH,
    changes: describeChanges(targetDir, plan.planned), ownerSteps: lifecycleOwnerSteps(versions),
    nextSteps: [...plan.toolchainUpdates.filter(dep => dep.lockedAffected && dep.from === dep.to && !dep.manual)
      .map(dep => `pnpm update ${dep.name}`), 'pnpm install', 'nimi-app sync', 'nimi-app check'],
    dependencyCombination: describeCombination(plan.combination, toolVersions),
    ...(scaffold ? { retainedHostFiles: scaffold.snapshot.retainedHostFiles ?? [] } : {}),
    ...(scaffold ? { ownershipHandover: handovers } : {}),
  };
  if (!options.json) {
    if (preview.retainedHostFiles?.length) process.stdout.write(`[nimi-app] Retained ${preview.retainedHostFiles.length} locked Host files for the selected SDK/Kit combination.\n`);
    for (const dep of dependencyChanges) process.stdout.write(`[nimi-app] ${dep.kind}: ${dep.name} ${dep.from ?? '(unset)'} -> ${dep.to}\n`);
    for (const dep of plan.toolchainUpdates) {
      const action = dep.manual ? 'select a patched range manually' : `sync target ${dep.to}`;
      process.stdout.write(`[nimi-app] ${dep.name}: declared ${dep.from}, locked ${dep.locked ?? '(unresolved)'}, ${action} (fix ${dep.fixedVersion})\n`);
    }
  }
  if (options.dryRun) {
    emitOwnershipHandovers(handovers, options);
    return emitResult(preview, options, `${preview.command} preview: ${preview.changes.map((file) => `${file.action} ${file.path}`).join(', ') || 'no app-tools changes'}`);
  }
  if (manual.length) throw new Error('Select a patched dependency in package.json before sync: ' + manual.map(dep => `${dep.name}@${dep.from} (fixed in ${dep.fixedVersion})`).join(', '));
  const nimicoding = runNimicodingSync(targetDir, 'apply', runners);
  const lockPath = path.join(targetDir, SCAFFOLD_LOCK_PATH);
  const lockFile = plan.planned.find((file) => file.path === lockPath);
  const synchronizedFiles = applyProjectFiles(targetDir, [
    ...plan.planned.filter((file) => file !== lockFile),
    ...planLifecycleGuidance(targetDir),
  ]);
  assertProjectLifecycleCurrent(targetDir, versions, { managed: Boolean(scaffold) });
  if (scaffold) {
    validateManagedAppFiles(targetDir, scaffold.snapshot.lock);
    synchronizedFiles.push(...applyProjectFiles(targetDir, [lockFile]));
  }
  validateAppProject(targetDir, { silent: true }, versions, runners);
  emitOwnershipHandovers(handovers, options);
  if (!options.json && (dependencyChanges.length || plan.toolchainUpdates.length)) process.stdout.write(`[nimi-app] Next: ${preview.nextSteps.join(' -> ')}\n`);
  return emitResult({ ...preview, synchronizedFiles, nimicodingSync: nimicoding?.summary || null }, options, `${preview.command} completed for ${targetDir}`);
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c
export function syncAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  const guidance = planLifecycleGuidance(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  const effective = managed ? managedProjectVersions(targetDir, versions) : versions;
  const scaffold = managed ? planManagedAppSync(targetDir, {}, effective) : null;
  const base = scaffold?.planned || [];
  const plan = buildExistingSubmittedAppSyncPlan(targetDir, effective, planSources(targetDir, base), managed);
  plan.planned = [...base, ...plan.planned, ...guidance];
  return executeProjectPlan(targetDir, options, effective, runners, plan, scaffold, versions);
}

function adoptionSources(targetDir, options) {
  const input = options.input ? readJsonFile(path.resolve(targetDir, options.input), 'adoption input') : {};
  assertExactKeys(input, 'adoption input', [], ['manifest', 'build_profile']);
  const sources = new Map();
  for (const [key, relativePath] of [['manifest', 'nimi.app.yaml'], ['build_profile', BUILD_PROFILE_PATH]]) {
    if (!Object.hasOwn(input, key)) continue;
    requireObject(input[key], `adoption input ${key}`);
    if (existsSync(path.join(targetDir, relativePath))) {
      const existing = parseYamlFile(readProjectText(targetDir, relativePath), relativePath);
      if (stableInputJson(existing) !== stableInputJson(input[key])) throw new Error(`Adoption input conflicts with ${relativePath}`);
    } else sources.set(relativePath, stringifyYaml(input[key], { lineWidth: 0 }));
  }
  return sources;
}

function stableInputJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableInputJson(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(stableInputJson(value[key]))])));
  return JSON.stringify(value);
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-008
export function adoptAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  if (existsSync(path.join(targetDir, SCAFFOLD_INTENT_PATH)) || existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH))) {
    throw new Error('Existing-App adoption cannot replace fresh scaffold intent/lock. Use nimi-app init or sync for this scaffold.');
  }
  const guidance = planLifecycleGuidance(targetDir);
  const sources = adoptionSources(targetDir, options);
  let plan;
  try {
    plan = buildExistingSubmittedAppSyncPlan(targetDir, versions, sources);
  } catch (cause) {
    throw new Error(`${cause.message}. Prepare the real App-owned Host and build/test inputs using ${LIFECYCLE_SKILL_PATH}`, { cause });
  }
  const files = readProjectLifecycleFiles(targetDir, sources);
  const profile = readBuildProfile(targetDir, sources);
  for (const command of [profile.testCommand, profile.buildCommand, ...Object.keys(profile.targets).map((target) => selectBuildOwner(profile, target).command)]) {
    const script = command.match(/^pnpm\s+run\s+([^\s]+)(?:\s|$)/u)?.[1];
    if (script && (!files.packageJson.scripts?.[script] || /\bnimi-app\s+(?:test|build)\b/u.test(files.packageJson.scripts[script]))) {
      throw new Error(`Adoption requires an actual non-recursive package script: ${script}`);
    }
  }
  const established = hasLifecycleGuidanceOwner(targetDir);
  const boundary = plannedFile(targetDir, '.nimi/contracts/scaffold-boundary.yaml', renderScaffoldBoundary());
  plan.planned.push(boundary, ...[...sources].map(([relativePath, content]) => plannedFile(targetDir, relativePath, content)), ...guidance);
  if (!established) {
    for (const file of plan.planned.filter((file) => [MANAGED_WORKFLOW_PATH, APP_IDENTITY_PATH, '.nimi/contracts/scaffold-boundary.yaml'].includes(path.relative(targetDir, file.path).split(path.sep).join('/')))) {
      if (file.previous !== null && !Buffer.from(file.previous).equals(Buffer.from(file.content))) throw new Error(`Unknown adoption file collision: ${path.relative(targetDir, file.path)}`);
    }
  }
  return executeProjectPlan(targetDir, { ...options, adopt: true }, versions, runners, plan, null);
}

export function checkAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  assertNoRetiredScaffoldState(targetDir);
  const managed = existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH));
  const effective = managed ? managedProjectVersions(targetDir, versions) : versions;
  const existingState = managed ? null : assertProjectLifecycleCurrent(targetDir, effective, { requireInstalledLock: true, production: options.production === true, managed });
  const validation = validateAppProject(cwd, { dir: targetDir, silent: true }, effective, runners);
  let nimicoding = null;
  if (!managed) nimicoding = runNimicodingSync(targetDir, 'check', runners);
  const { descriptor, buildProfile, combination } = existingState || assertProjectLifecycleCurrent(targetDir, effective, { requireInstalledLock: true, production: options.production === true, managed });
  if (options.production === true) {
    if (descriptor.platform === 'web' && !descriptor.publicSlug) throw new Error('Web release preflight requires a hosted public_slug; use development check for other Web sources.');
    if (descriptor.platform !== 'web') for (const target of Object.keys(buildProfile.targets)) readAppInfo(targetDir, target);
  }
  const safetyProfile = descriptor.safetyProfile ? 'declared' : 'undeclared';
  if (options.production === true && !options.json && safetyProfile === 'undeclared') {
    process.stdout.write('[nimi-app] safety_profile is not declared in nimi.app.yaml; local builds, private packages and local import remain usable. Whether a public submission requires the declaration is determined by the current Registry admission policy.\n');
  }
  return emitResult({
    ok: true,
    command: 'check',
    dir: targetDir,
    production: options.production === true,
    managed,
    appId: descriptor.appId,
    profile: descriptor.profile,
    ...(descriptor.platform === 'web' ? { platform: 'web' } : {}),
    safetyProfile,
    dependencyCombination: describeCombination(combination, versions),
    targets: Object.keys(buildProfile.targets).sort(),
    checkedManagedFiles: validation.checkedManagedFiles,
    checkedExistingFiles: validation.checkedExistingFiles,
    nimicodingSync: nimicoding?.summary || null,
  }, options, `check passed for ${targetDir}`);
}

export function testAppProject(cwd, options = {}, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const profile = readBuildProfile(targetDir);
  if (profile.testCommand === 'pnpm run test:app'
    && readJsonFile(path.join(targetDir, 'package.json'), 'package.json').scripts?.['test:app'] === 'node --test test/*.test.mjs'
    && globSync('test/*.test.mjs', { cwd: targetDir }).length === 0) {
    throw new Error('No App tests found. Add a business test under test/*.test.mjs or configure the App-owned test:app script.');
  }
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
  if (options.production === true && profile.buildProfileRef === 'web-pnpm') throw new Error('For a hosted Web release, use nimi-app check --production and your build:release script. Use nimi-app build for ordinary static output.');
  if (options.production === true) readAppInfo(targetDir, selected.target);
  const result = runOwnerCommand(targetDir, 'build', selected.command, options, runners);
  assertBuiltRuntimeEntry(targetDir, selected);
  return emitResult({
    ok: true,
    command: 'build',
    dir: targetDir,
    target: selected.target,
    ownerCommand: selected.command,
    ...(options.json ? { stdout: result.stdout || '', stderr: result.stderr || '' } : {}),
  }, options, `build completed for ${selected.target}`);
}
