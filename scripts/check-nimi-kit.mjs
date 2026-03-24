#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const registryPath = path.join(repoRoot, 'spec', 'platform', 'kernel', 'tables', 'nimi-kit-registry.yaml');
const packageJsonPath = path.join(kitRoot, 'package.json');

const allowedKinds = new Set(['foundation', 'feature', 'logic', 'infra']);
const allowedModuleDirs = new Set(['ui', 'auth', 'core', 'telemetry', 'features']);
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

const registry = readYaml(registryPath);
const kitPackage = readJson(packageJsonPath);
const packageExportsMap = kitPackage.exports || {};
const packageExports = new Set(Object.keys(packageExportsMap));
const modules = Array.isArray(registry?.modules) ? registry.modules : [];
const appAliasPattern = /^@(renderer|runtime|app|desktop|forge|relay|web|overtone|realm-drift)(\/|$)/u;
const registeredExportKeys = new Set();
const featureReadmePaths = [];

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
  const dependencies = Array.isArray(row?.dependencies) ? row.dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const peerDependencies = Array.isArray(row?.peer_dependencies) ? row.peer_dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const exportsList = Array.isArray(row?.exports) ? row.exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const headlessExports = Array.isArray(row?.headless_exports) ? row.headless_exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const uiExports = Array.isArray(row?.ui_exports) ? row.ui_exports.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const reuseEntrypoints = Array.isArray(row?.reuse_entrypoints) ? row.reuse_entrypoints.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const plannedConsumers = Array.isArray(row?.planned_consumers) ? row.planned_consumers.map((item) => String(item || '').trim()).filter(Boolean) : [];

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
  expect(exportsList.length > 0, `nimi-kit-registry.yaml ${id}: exports must not be empty`);
  expect(Array.isArray(row?.headless_exports), `nimi-kit-registry.yaml ${id}: headless_exports must be an array`);
  expect(Array.isArray(row?.ui_exports), `nimi-kit-registry.yaml ${id}: ui_exports must be an array`);
  expect(Array.isArray(row?.reuse_entrypoints), `nimi-kit-registry.yaml ${id}: reuse_entrypoints must be an array`);
  expect(Array.isArray(row?.planned_consumers), `nimi-kit-registry.yaml ${id}: planned_consumers must be an array`);

  const modulePath = subpath.replace(/^\//, '');
  const moduleDir = modulePath.split('/')[0] || '';
  expect(allowedModuleDirs.has(moduleDir), `nimi-kit-registry.yaml ${id}: unsupported module dir ${moduleDir}`);
  registeredModuleSubpaths.add(modulePath);

  const absModuleDir = path.join(kitRoot, modulePath);
  expect(fs.existsSync(absModuleDir), `registered module missing from disk: kit/${modulePath}`);
  expect(!fs.existsSync(path.join(absModuleDir, 'package.json')), `kit/${modulePath}: nested package.json is forbidden in single-package kit`);
  expect(!fs.existsSync(path.join(absModuleDir, 'tsconfig.json')), `kit/${modulePath}: nested tsconfig.json should be consolidated at kit/tsconfig.json`);
  expect(fs.existsSync(path.join(absModuleDir, 'README.md')), `kit/${modulePath}: module README.md is required`);
  if (modulePath.startsWith('features/')) {
    featureReadmePaths.push(path.join(absModuleDir, 'README.md'));
  }

  for (const key of exportsList) {
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
    expect(dependencies.length === 0, `${id}: foundation module must not depend on other kit modules`);
  }
  if (kind === 'logic' || kind === 'infra') {
    expect(dependencies.length === 0, `${id}: ${kind} module must not declare runtime kit dependencies`);
  }
  if (kind === 'feature') {
    expect(peerDependencies.includes('react'), `${id}: feature module must declare react peer dependency`);
    expect(headlessExports.length > 0, `${id}: feature module must expose headless exports`);
    expect(uiExports.length > 0, `${id}: feature module must expose UI exports`);
    expect(reuseEntrypoints.length > 0, `${id}: feature module must declare reuse_entrypoints`);
    expect(plannedConsumers.length >= 2, `${id}: feature module must be planned for at least two apps`);
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
  const exportPath = String(target || '').trim();
  if (!exportPath) {
    fail(`kit/package.json: export ${exportKey} must have a non-empty target`);
    continue;
  }
  const absTarget = path.join(kitRoot, exportPath.replace(/^\.\//, ''));
  expect(fs.existsSync(absTarget), `kit/package.json: export ${exportKey} points to missing target ${exportPath}`);

  const isKitSurfaceExport =
    exportKey.startsWith('./ui')
    || exportKey.startsWith('./auth')
    || exportKey.startsWith('./core/')
    || exportKey.startsWith('./telemetry')
    || exportKey.startsWith('./features/');

  if (isKitSurfaceExport && !registeredExportKeys.has(exportKey)) {
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
];

for (const modulePath of onDiskModules) {
  if (!registeredModuleSubpaths.has(modulePath)) {
    fail(`on-disk kit module is unregistered: kit/${modulePath}`);
  }
}

for (const modulePath of registeredModuleSubpaths) {
  const absDir = path.join(kitRoot, modulePath);
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
      if (target.includes('apps/')) {
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
      if (isFeatureRuntimeIntegrationFile(fileRel) && content.includes('getPlatformClient().realm')) {
        fail(`${fileRel}: runtime integration files must not bind getPlatformClient().realm`);
      }
      if (isFeatureRealmIntegrationFile(fileRel) && content.includes('getPlatformClient().runtime')) {
        fail(`${fileRel}: realm integration files must not bind getPlatformClient().runtime`);
      }
      for (const target of importTargets) {
        if (
          (target === '@nimiplatform/sdk' || target.startsWith('@nimiplatform/sdk/'))
          && !isFeatureSdkIntegrationFile(fileRel)
          && !isKitFeatureTestFile(fileRel)
        ) {
          fail(`${fileRel}: feature modules must stay adapter-driven and must not import sdk directly (${target})`);
        }
        if (target.startsWith('@tauri-apps/') || target === 'electron' || target.startsWith('electron/')) {
          fail(`${fileRel}: feature modules must not import platform bridges directly (${target})`);
        }
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
