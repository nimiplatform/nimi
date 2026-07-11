#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const registryPath = path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-kit-registry.yaml');
const standardShellCatalogPath = path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'standard-shell-capabilities.yaml');
const packageJsonPath = path.join(kitRoot, 'package.json');

const allowedKinds = new Set(['foundation', 'feature', 'logic', 'infra']);
const allowedModuleDirs = new Set(['ui', 'auth', 'core', 'telemetry', 'features', 'shell']);
const violations = [];

function fail(message) {
  violations.push(message);
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function readYaml(absPath) {
  return YAML.parse(fs.readFileSync(absPath, 'utf8'));
}

function resolveModuleSourceDir(modulePath) {
  const directDir = path.join(kitRoot, modulePath);
  if (fs.existsSync(directDir) && fs.statSync(directDir).isDirectory()) {
    return {
      absDir: directDir,
      direct: true,
    };
  }

  const exportKey = `./${modulePath}`;
  const exportTarget = resolvePackageExportTarget(packageExportsMap[exportKey]);
  if (exportTarget) {
    const absTarget = path.join(kitRoot, packageExportTargetToSourceTarget(exportTarget).replace(/^\.\//, ''));
    if (fs.existsSync(absTarget)) {
      const stat = fs.statSync(absTarget);
      return {
        absDir: stat.isDirectory() ? absTarget : path.dirname(absTarget),
        direct: false,
      };
    }
  }

  return {
    absDir: directDir,
    direct: false,
  };
}

function resolvePackageExportTarget(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    for (const condition of ['import', 'default', 'types']) {
      if (typeof value[condition] === 'string') {
        return value[condition].trim();
      }
    }
  }
  return '';
}

function packageExportTargetToSourceTarget(exportTarget) {
  const normalized = String(exportTarget || '').trim();
  if (!normalized.startsWith('./dist/')) {
    return normalized;
  }

  const sourceCandidates = [];
  const distRelative = normalized
    .replace(/^\.\//, '')
    .replace(/^dist\//, '')
    .replace(/\.d\.cts$/u, '')
    .replace(/\.d\.ts$/u, '')
    .replace(/\.cjs$/u, '')
    .replace(/\.js$/u, '')
    .replace(/\.css$/u, '.css');

  if (distRelative.startsWith('features/')) {
    const parts = distRelative.split('/');
    sourceCandidates.push(`./${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`);
  } else if (distRelative.startsWith('shell/')) {
    const parts = distRelative.split('/');
    sourceCandidates.push(`./${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`);
  } else if (distRelative.startsWith('telemetry/')) {
    sourceCandidates.push(`./telemetry/src/${distRelative.replace(/^telemetry\//u, '')}`);
  } else {
    const [root, ...rest] = distRelative.split('/');
    sourceCandidates.push(`./${root}/src/${rest.join('/')}`);
  }

  for (const candidate of sourceCandidates) {
    for (const extension of ['', '.ts', '.tsx', '.cts', '.css']) {
      const withExtension = candidate.endsWith('.css') ? candidate : `${candidate}${extension}`;
      if (fs.existsSync(path.join(kitRoot, withExtension.replace(/^\.\//, '')))) {
        return withExtension;
      }
    }
  }

  return normalized;
}

function listFilesRecursively(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(abs, predicate));
      continue;
    }
    if (!predicate || predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function isFeatureRuntimeIntegrationFile(fileRel) {
  return /^kit\/features\/[^/]+\/src\/runtime(?:\/|\.ts$)/u.test(fileRel);
}

function isFeatureRealmIntegrationFile(fileRel) {
  return /^kit\/features\/[^/]+\/src\/realm(?:\/|\.ts$)/u.test(fileRel);
}

function isFeatureSdkIntegrationFile(fileRel) {
  return isFeatureRuntimeIntegrationFile(fileRel) || isFeatureRealmIntegrationFile(fileRel);
}

function isKitFeatureTestFile(fileRel) {
  return /^kit\/features\/[^/]+\/test\//u.test(fileRel);
}

function isKitShellTestFile(fileRel) {
  return /^kit\/shell\/[^/]+\/test\//u.test(fileRel);
}

function isShellModule(modulePath) {
  return modulePath.startsWith('shell/');
}

function allowsEmptyExports(modulePath, notes) {
  return isShellModule(modulePath) && /non-npm rust crate/iu.test(notes);
}

function allowsMissingModuleReadme(modulePath, notes) {
  return isShellModule(modulePath) && /non-npm rust crate/iu.test(notes);
}

function isElectronShellModule(modulePath) {
  return modulePath === 'shell/electron' || modulePath.startsWith('shell/electron/');
}

function isRendererShellModule(modulePath) {
  return modulePath === 'shell/renderer' || modulePath.startsWith('shell/renderer/');
}

function isCapabilitiesShellModule(modulePath) {
  return modulePath === 'shell/capabilities' || modulePath.startsWith('shell/capabilities/');
}

function isAppLayerImport(target) {
  return /^apps\//u.test(target) || /(^|\/)apps\//u.test(target);
}

function isTypeOnlyImport(content, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`import\\s+type\\b[\\s\\S]*?from\\s+['"]${escaped}['"]`, 'u');
  return pattern.test(content);
}

function expect(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function extractImportTargets(content) {
  return [
    ...content.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ...content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => String(match[1] || '').trim()).filter(Boolean);
}

function declaredCssVariables(content) {
  return [...content.matchAll(/(^|\s)(--[a-zA-Z0-9_-]+)\s*:/gm)].map((match) => String(match[2] || ''));
}

function discoverAppLocalThemeExports() {
  const manifestRels = [];
  const appsRoot = path.join(repoRoot, 'apps');
  if (fs.existsSync(appsRoot)) {
    for (const entry of fs.readdirSync(appsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      manifestRels.push(path.join('apps', entry.name, 'spec', 'kernel', 'tables', 'nimi-kit-themes.yaml'));
    }
  }

  const nimiSpecRoot = path.join(repoRoot, '.nimi', 'spec');
  if (fs.existsSync(nimiSpecRoot)) {
    for (const entry of fs.readdirSync(nimiSpecRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'platform' || entry.name.startsWith('_')) continue;
      manifestRels.push(path.join('.nimi', 'spec', entry.name, 'kernel', 'tables', 'nimi-kit-themes.yaml'));
    }
  }

  const exports = new Set();
  for (const relPath of manifestRels) {
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath)) continue;
    const doc = readYaml(absPath);
    for (const pack of Array.isArray(doc?.packs) ? doc.packs : []) {
      const themeId = String(pack?.theme_id || '').trim();
      if (!themeId) continue;
      exports.add(`./ui/themes/${themeId}.css`);
    }
  }
  return exports;
}

const registry = readYaml(registryPath);
const standardShellCatalog = readYaml(standardShellCatalogPath);
const kitPackage = readJson(packageJsonPath);
const packageExportsMap = kitPackage.exports || {};
const packageExports = new Set(Object.keys(packageExportsMap));
const appLocalThemeExports = discoverAppLocalThemeExports();
const modules = Array.isArray(registry?.modules) ? registry.modules : [];
const appAliasPattern = /^@(renderer|runtime|app|desktop|web)(\/|$)/u;
const registeredExportKeys = new Set();
const featureReadmePaths = [];
const requiredStandardShellCapabilityIds = [
  'runtime',
  'runtime-lifecycle',
  'runtime-defaults',
  'oauth',
  'desktop-open',
  'shell-ui',
  'diagnostics',
  'data',
  'storage',
  'config',
  'local-assets',
  'local-agent',
  'ai-profile',
  'ai-config',
  'avatar',
  'agent-center',
  'platform-projection',
  'file-dialog',
  'file-reveal',
  'export',
  'artifacts',
  'floating-window',
];
const requiredStandardShellErrorCodes = [
  'capability-unavailable',
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-repair-required',
  'external-daemon-required',
  'runtime-permission-denied',
  'runtime-unauthenticated',
  'forbidden-renderer-access',
  'invalid-path',
  'not-found',
  'resource-exhausted',
  'invalid-payload',
  'host-internal-error',
];
const requiredRetiredAuthSessionForbiddenOperations = [
  'auth.sessionLoad',
  'auth.sessionSave',
  'auth.sessionClear',
];

function assertStandardShellCapabilityCatalog() {
  expect(packageExports.has('./shell/capabilities'), 'kit/package.json: missing standard shell capabilities export ./shell/capabilities');
  const capabilities = Array.isArray(standardShellCatalog?.capabilities) ? standardShellCatalog.capabilities : [];
  const capabilityIds = capabilities.map((entry) => String(entry?.id || '').trim()).filter(Boolean);
  expect(
    JSON.stringify(capabilityIds) === JSON.stringify(requiredStandardShellCapabilityIds),
    `standard-shell-capabilities.yaml: capability ids must equal ${requiredStandardShellCapabilityIds.join(', ')}`,
  );

  const errorCodes = Array.isArray(standardShellCatalog?.error_envelope?.codes)
    ? standardShellCatalog.error_envelope.codes.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  expect(
    JSON.stringify(errorCodes) === JSON.stringify(requiredStandardShellErrorCodes),
    `standard-shell-capabilities.yaml: error codes must equal ${requiredStandardShellErrorCodes.join(', ')}`,
  );

  const missingRuntimeUnavailableCoverage = capabilities
    .find((entry) => entry?.id === 'runtime')
    ?.operations
    ?.filter((operation) => ['unary', 'streamOpen'].includes(String(operation?.id || '')))
    ?.some((operation) => !Array.isArray(operation?.negative_states) || !operation.negative_states.includes('protected-carrier-required'));
  expect(!missingRuntimeUnavailableCoverage, 'standard-shell-capabilities.yaml: runtime unary/streamOpen must include protected-carrier-required negative coverage');

  const capabilitySourcePath = path.join(kitRoot, 'shell', 'capabilities', 'src', 'index.ts');
  const capabilitySourceRoot = path.join(kitRoot, 'shell', 'capabilities', 'src');
  expect(fs.existsSync(capabilitySourcePath), 'kit/shell/capabilities/src/index.ts is required');
  const capabilitySource = readSourceTree(capabilitySourceRoot, /\.(?:ts|tsx)$/u);
  for (const id of capabilityIds) {
    expect(capabilitySource.includes(`'${id}'`), `kit/shell/capabilities/src/index.ts: missing capability id ${id}`);
  }
  for (const code of errorCodes) {
    expect(capabilitySource.includes(`'${code}'`), `kit/shell/capabilities/src/index.ts: missing standard error code ${code}`);
  }
  for (const capability of capabilities) {
    for (const operation of Array.isArray(capability?.operations) ? capability.operations : []) {
      const command = String(operation?.command || '').trim();
      expect(command, `standard-shell-capabilities.yaml ${capability?.id || '<unknown>'}: operation command is required`);
      expect(capabilitySource.includes(`'${command}'`), `kit/shell/capabilities/src/index.ts: missing standard command ${command}`);
    }
  }

  const commandByOperationRef = new Map();
  for (const capability of capabilities) {
    const capabilityId = String(capability?.id || '').trim();
    for (const operation of Array.isArray(capability?.operations) ? capability.operations : []) {
      const operationId = String(operation?.id || '').trim();
      const command = String(operation?.command || '').trim();
      if (capabilityId && operationId && command) {
        commandByOperationRef.set(`${capabilityId}.${operationId}`, command);
      }
    }
  }
  const capabilitySets = Array.isArray(standardShellCatalog?.capability_sets)
    ? standardShellCatalog.capability_sets
    : [];
  const installedSet = capabilitySets.find((entry) => String(entry?.set_id || '').trim() === 'installed-nimi-app-standard-shell-v1');
  expect(installedSet, 'standard-shell-capabilities.yaml: missing installed-nimi-app-standard-shell-v1 capability set');
  expect(
    String(installedSet?.source_rule || '').trim() === 'P-KIT-044',
    'standard-shell-capabilities.yaml: installed-nimi-app-standard-shell-v1 must be owned by P-KIT-044',
  );
  expect(
    capabilitySource.includes('NIMI_STANDARD_SHELL_CAPABILITY_SETS')
      && capabilitySource.includes(`'installed-nimi-app-standard-shell-v1'`)
      && capabilitySource.includes(`'P-KIT-044'`),
    'kit/shell/capabilities/src/index.ts: missing installed app capability-set projection',
  );
  expect(installedSet?.authority_status === 'a4_windows_x64_artifact_read_admitted', 'standard-shell-capabilities.yaml: installed app capability set must retain narrow Windows x64 artifact-read admission');
  expect(
    JSON.stringify(installedSet?.allowed_operations) === JSON.stringify(['artifacts.readRuntimeBytes']),
    'standard-shell-capabilities.yaml: installed app capability set must admit only artifacts.readRuntimeBytes',
  );
  expect(installedSet?.planned_operations_disposition === 'deny_until_separate_operation_admission', 'standard-shell-capabilities.yaml: every other planned installed app operation must remain deny-only');
  for (const field of ['planned_operations', 'forbidden_operations', 'negative_tests']) {
    expect(
      Array.isArray(installedSet?.[field]) && installedSet[field].length > 0,
      `standard-shell-capabilities.yaml: installed-nimi-app-standard-shell-v1 ${field} must not be empty`,
    );
  }
  for (const operationRef of Array.isArray(installedSet?.planned_operations) ? installedSet.planned_operations : []) {
    const normalizedRef = String(operationRef || '').trim();
    const command = commandByOperationRef.get(normalizedRef);
    expect(command, `standard-shell-capabilities.yaml: capability set planned operation ${normalizedRef} must resolve to a standard command`);
    expect(capabilitySource.includes(`'${normalizedRef}'`), `kit/shell/capabilities/src/index.ts: missing planned capability set operation ${normalizedRef}`);
    expect(capabilitySource.includes(`'${command}'`), `kit/shell/capabilities/src/index.ts: missing planned capability set command ${command}`);
  }
  for (const retiredOperation of requiredRetiredAuthSessionForbiddenOperations) {
    expect(
      installedSet.forbidden_operations.includes(retiredOperation),
      `standard-shell-capabilities.yaml: retired ${retiredOperation} must remain explicit forbidden vocabulary`,
    );
  }
  for (const operationRef of Array.isArray(installedSet?.allowed_operations) ? installedSet.allowed_operations : []) {
    const normalizedRef = String(operationRef || '').trim();
    const command = commandByOperationRef.get(normalizedRef);
    expect(command, `standard-shell-capabilities.yaml: capability set allowed operation ${normalizedRef} must resolve to a standard command`);
    expect(capabilitySource.includes(`'${normalizedRef}'`), `kit/shell/capabilities/src/index.ts: missing capability set operation ${normalizedRef}`);
    expect(capabilitySource.includes(`'${command}'`), `kit/shell/capabilities/src/index.ts: missing capability set command ${command}`);
  }
  for (const operationRef of Array.isArray(installedSet?.forbidden_operations) ? installedSet.forbidden_operations : []) {
    const normalizedRef = String(operationRef || '').trim();
    const command = commandByOperationRef.get(normalizedRef);
    expect(capabilitySource.includes(`'${normalizedRef}'`), `kit/shell/capabilities/src/index.ts: missing capability set operation ${normalizedRef}`);
    if (command) {
      expect(capabilitySource.includes(`'${command}'`), `kit/shell/capabilities/src/index.ts: missing capability set command ${command}`);
    }
  }
}

function readSourceTree(root, pattern) {
  const chunks = [];
  if (!fs.existsSync(root)) {
    return '';
  }
  const walk = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        walk(path.join(target, entry));
      }
      return;
    }
    if (pattern.test(target)) {
      chunks.push(fs.readFileSync(target, 'utf8'));
    }
  };
  walk(root);
  return chunks.join('\n');
}

assertStandardShellCapabilityCatalog();

if (modules.length === 0) {
  fail('nimi-kit-registry.yaml: modules must not be empty');
}

const registeredModuleSubpaths = new Set();

for (const row of modules) {
  const id = String(row?.id || '').trim();
  const subpath = String(row?.subpath || '').trim();
  const kind = String(row?.kind || '').trim();
  const description = String(row?.description || '').trim();
  const sourceRule = String(row?.source_rule || '').trim();
  const admissionStatus = String(row?.admission_status || '').trim();
  const owner = String(row?.owner || '').trim();
  const surfaceLevel = String(row?.surface_level || '').trim();
  const adapterContract = String(row?.adapter_contract || '').trim();
  const notes = String(row?.notes || '').trim();
  const dependencies = Array.isArray(row?.dependencies) ? row.dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const internalKitDependencies = dependencies.filter((item) => item.startsWith('kit.'));
  const peerDependencies = Array.isArray(row?.peer_dependencies) ? row.peer_dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const exportsList = Array.isArray(row?.exports) ? row.exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const headlessExports = Array.isArray(row?.headless_exports) ? row.headless_exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const uiExports = Array.isArray(row?.ui_exports) ? row.ui_exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const reuseEntrypoints = Array.isArray(row?.reuse_entrypoints) ? row.reuse_entrypoints.map((item) => String(item || '').trim()).filter(Boolean) : [];

  expect(id, 'nimi-kit-registry.yaml: module row missing id');
  expect(subpath.startsWith('/'), `nimi-kit-registry.yaml ${id}: subpath must start with /`);
  expect(allowedKinds.has(kind), `nimi-kit-registry.yaml ${id}: invalid kind ${kind}`);
  expect(description, `nimi-kit-registry.yaml ${id}: description is required`);
  expect(sourceRule, `nimi-kit-registry.yaml ${id}: source_rule is required`);
  expect(admissionStatus, `nimi-kit-registry.yaml ${id}: admission_status is required`);
  expect(owner, `nimi-kit-registry.yaml ${id}: owner is required`);
  expect(surfaceLevel, `nimi-kit-registry.yaml ${id}: surface_level is required`);
  expect(adapterContract, `nimi-kit-registry.yaml ${id}: adapter_contract is required`);
  expect(Array.isArray(row?.dependencies), `nimi-kit-registry.yaml ${id}: dependencies must be an array`);
  expect(Array.isArray(row?.peer_dependencies), `nimi-kit-registry.yaml ${id}: peer_dependencies must be an array`);
  const modulePath = subpath.replace(/^\//, '');
  if (!allowsEmptyExports(modulePath, notes)) {
    expect(exportsList.length > 0, `nimi-kit-registry.yaml ${id}: exports must not be empty`);
  }
  expect(Array.isArray(row?.headless_exports), `nimi-kit-registry.yaml ${id}: headless_exports must be an array`);
  expect(Array.isArray(row?.ui_exports), `nimi-kit-registry.yaml ${id}: ui_exports must be an array`);
  expect(Array.isArray(row?.reuse_entrypoints), `nimi-kit-registry.yaml ${id}: reuse_entrypoints must be an array`);
  expect(!Object.prototype.hasOwnProperty.call(row, 'planned_consumers'), `nimi-kit-registry.yaml ${id}: planned_consumers is forbidden; concrete consumption truth belongs in app-local kit manifests`);
  const moduleDir = modulePath.split('/')[0] || '';
  expect(allowedModuleDirs.has(moduleDir), `nimi-kit-registry.yaml ${id}: unsupported module dir ${moduleDir}`);
  registeredModuleSubpaths.add(modulePath);

  const resolvedModule = resolveModuleSourceDir(modulePath);
  const absModuleDir = resolvedModule.absDir;
  expect(fs.existsSync(absModuleDir), `registered module missing from disk: kit/${modulePath}`);
  expect(!fs.existsSync(path.join(absModuleDir, 'package.json')), `kit/${modulePath}: nested package.json is forbidden in single-package kit`);
  expect(!fs.existsSync(path.join(absModuleDir, 'tsconfig.json')), `kit/${modulePath}: nested tsconfig.json should be consolidated at kit/tsconfig.json`);
  if (resolvedModule.direct && !allowsMissingModuleReadme(modulePath, notes)) {
    expect(fs.existsSync(path.join(absModuleDir, 'README.md')), `kit/${modulePath}: module README.md is required`);
  }
  if (modulePath.startsWith('features/') && resolvedModule.direct) {
    featureReadmePaths.push(path.join(absModuleDir, 'README.md'));
  }

  for (const key of exportsList) {
    expect(!/[<>]/u.test(key), `nimi-kit-registry.yaml ${id}: export ${key} must be a concrete package export, not a placeholder`);
    expect(packageExports.has(key), `nimi-kit-registry.yaml ${id}: export ${key} missing from kit/package.json`);
    registeredExportKeys.add(key);
  }
  for (const key of headlessExports) {
    expect(exportsList.includes(key), `nimi-kit-registry.yaml ${id}: headless export ${key} must also exist in exports`);
  }
  for (const key of uiExports) {
    expect(exportsList.includes(key), `nimi-kit-registry.yaml ${id}: ui export ${key} must also exist in exports`);
  }
  for (const key of reuseEntrypoints) {
    expect(exportsList.includes(key), `nimi-kit-registry.yaml ${id}: reuse entrypoint ${key} must also exist in exports`);
  }

  if (kind === 'foundation') {
    expect(internalKitDependencies.length === 0, `${id}: foundation module must not depend on other kit modules`);
  }
  if (kind === 'logic') {
    expect(internalKitDependencies.length === 0, `${id}: ${kind} module must not declare runtime kit dependencies`);
  }
  if (kind === 'feature') {
    expect(peerDependencies.includes('react'), `${id}: feature module must declare react peer dependency`);
    expect(headlessExports.length > 0, `${id}: feature module must expose headless exports`);
    expect(uiExports.length > 0, `${id}: feature module must expose UI exports`);
    expect(reuseEntrypoints.length > 0, `${id}: feature module must declare reuse_entrypoints`);
    if (modulePath.startsWith('features/')) {
      expect(exportsList.includes(`./${modulePath}`), `${id}: feature module must publish aggregate export ./${modulePath}`);
      expect(headlessExports.includes(`./${modulePath}/headless`), `${id}: feature module must publish /headless export`);
      expect(uiExports.includes(`./${modulePath}/ui`), `${id}: feature module must publish /ui export`);
      if (surfaceLevel.includes('runtime')) {
        expect(exportsList.includes(`./${modulePath}/runtime`), `${id}: runtime-capable feature must publish /runtime export`);
      } else {
        expect(!exportsList.includes(`./${modulePath}/runtime`), `${id}: non-runtime feature must not publish /runtime export`);
      }
      if (surfaceLevel.includes('realm')) {
        expect(exportsList.includes(`./${modulePath}/realm`), `${id}: realm-capable feature must publish /realm export`);
      } else {
        expect(!exportsList.includes(`./${modulePath}/realm`), `${id}: non-realm feature must not publish /realm export`);
      }
    }
  }
}

expect(fs.existsSync(path.join(kitRoot, 'README.md')), 'kit/README.md is required');
const kitReadme = fs.readFileSync(path.join(kitRoot, 'README.md'), 'utf8');
expect(kitReadme.includes('## Reuse First'), 'kit/README.md must document the kit-first reuse order');

for (const absPath of featureReadmePaths) {
  const content = fs.readFileSync(absPath, 'utf8');
  expect(content.includes('## Before Building Locally'), `${rel(absPath)}: feature README must include "Before Building Locally" guidance`);
}

for (const [exportKey, target] of Object.entries(packageExportsMap)) {
  const exportPath = resolvePackageExportTarget(target);
  if (!exportPath) {
    fail(`kit/package.json: export ${exportKey} must have a non-empty target`);
    continue;
  }
  const sourceExportPath = packageExportTargetToSourceTarget(exportPath);
  const absTarget = path.join(kitRoot, sourceExportPath.replace(/^\.\//, ''));
  expect(fs.existsSync(absTarget), `kit/package.json: export ${exportKey} points to missing source target ${sourceExportPath}`);

  const isKitSurfaceExport =
    exportKey.startsWith('./ui')
    || exportKey.startsWith('./auth')
    || exportKey.startsWith('./core/')
    || exportKey.startsWith('./telemetry')
    || exportKey.startsWith('./shell/')
    || exportKey.startsWith('./features/');

  if (isKitSurfaceExport && !registeredExportKeys.has(exportKey) && !appLocalThemeExports.has(exportKey)) {
    fail(`kit/package.json: export ${exportKey} is not registered in nimi-kit-registry.yaml`);
  }
}

const onDiskModules = [
  'ui',
  'auth',
  'core',
  'telemetry',
  ...fs.readdirSync(path.join(kitRoot, 'features'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `features/${entry.name}`),
  ...fs.readdirSync(path.join(kitRoot, 'shell'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `shell/${entry.name}`),
];

for (const modulePath of onDiskModules) {
  if (!registeredModuleSubpaths.has(modulePath)) {
    fail(`on-disk kit module is unregistered: kit/${modulePath}`);
  }
}

for (const modulePath of registeredModuleSubpaths) {
  const absDir = resolveModuleSourceDir(modulePath).absDir;
  const moduleDir = modulePath.split('/')[0] || '';
  const files = listFilesRecursively(absDir, (absPath) => /\.(?:ts|tsx|css)$/u.test(absPath));
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    const fileRel = rel(absPath);
    const importTargets = extractImportTargets(content);

    if (content.includes('runtime/internal/')) {
      fail(`${fileRel}: kit modules must not reference runtime/internal/**`);
    }

    for (const target of importTargets) {
      if (isAppLayerImport(target)) {
        fail(`${fileRel}: kit modules must not import app-layer code (${target})`);
      }
      if (appAliasPattern.test(target)) {
        fail(`${fileRel}: kit modules must not import app aliases (${target})`);
      }
      if (target.includes('runtime/internal/')) {
        fail(`${fileRel}: kit modules must not import runtime internal code (${target})`);
      }
    }

    if (moduleDir === 'core') {
      if (/\.(css|scss|sass|less)['"]/u.test(content)) {
        fail(`${fileRel}: core must not import CSS`);
      }
      for (const target of importTargets) {
        if (target === 'react' || target.startsWith('react/')) {
          fail(`${fileRel}: core must not import React`);
        }
        if (target.includes('/ui') || target.includes('/auth') || target.includes('/telemetry')) {
          fail(`${fileRel}: core must not depend on other kit presentation modules (${target})`);
        }
      }
    }

    if (moduleDir === 'telemetry') {
      for (const target of importTargets) {
        const forbidden =
          target.startsWith('node:')
          || target === 'electron'
          || target.startsWith('electron/')
          || target.startsWith('@tauri-apps/')
          || ['fs', 'path', 'child_process', 'os'].includes(target);
        if (forbidden) {
          fail(`${fileRel}: telemetry must remain renderer-safe (${target})`);
        }
      }
    }

    if (modulePath.startsWith('features/')) {
      for (const target of importTargets) {
        if (
          (target === '@nimiplatform/sdk' || target.startsWith('@nimiplatform/sdk/'))
          && !isFeatureSdkIntegrationFile(fileRel)
          && !isKitFeatureTestFile(fileRel)
          && !isTypeOnlyImport(content, target)
        ) {
          fail(`${fileRel}: feature modules must stay adapter-driven and must not import sdk directly (${target})`);
        }
        if (target.startsWith('@tauri-apps/') || target === 'electron' || target.startsWith('electron/')) {
          fail(`${fileRel}: feature modules must not import platform bridges directly (${target})`);
        }
      }
    }

    if (isRendererShellModule(modulePath)) {
      for (const target of importTargets) {
        if (target === 'electron' || target.startsWith('electron/') || target.includes('/shell/electron')) {
          fail(`${fileRel}: shell/renderer must stay host-neutral and must not import Electron host glue (${target})`);
        }
      }
    }

    if (isCapabilitiesShellModule(modulePath) && !isKitShellTestFile(fileRel)) {
      for (const target of importTargets) {
        const forbidden =
          target === 'react'
          || target.startsWith('react/')
          || target === 'electron'
          || target.startsWith('electron/')
          || target.startsWith('@tauri-apps/')
          || target.startsWith('node:')
          || ['fs', 'path', 'child_process', 'os'].includes(target);
        if (forbidden) {
          fail(`${fileRel}: shell/capabilities must remain host-neutral contract code (${target})`);
        }
      }
    }

    if (isElectronShellModule(modulePath)) {
      for (const target of importTargets) {
        if (target === 'react' || target.startsWith('react/')) {
          fail(`${fileRel}: shell/electron must not import React renderer code (${target})`);
        }
        if (target.startsWith('@tauri-apps/')) {
          fail(`${fileRel}: shell/electron must not import Tauri bridge code (${target})`);
        }
      }
      if (/ipcRenderer\s*[,}]/u.test(content) || /from\s+['"]electron['"]/u.test(content)) {
        fail(`${fileRel}: shell/electron package surface must use injected preload/main Electron adapters instead of re-exporting raw electron primitives`);
      }
    }
  }
}

const authCssFiles = listFilesRecursively(path.join(kitRoot, 'auth'), (absPath) => absPath.endsWith('.css'));
for (const absPath of authCssFiles) {
  const content = fs.readFileSync(absPath, 'utf8');
  for (const variable of declaredCssVariables(content)) {
    if (!variable.startsWith('--nimi-')) {
      fail(`${rel(absPath)}: auth must not declare non-nimi CSS variables (${variable})`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`nimi-kit check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('nimi-kit check passed\n');
