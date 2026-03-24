#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const registryPath = path.join(repoRoot, 'spec', 'platform', 'kernel', 'tables', 'nimi-kit-registry.yaml');
const packageJsonPath = path.join(kitRoot, 'package.json');

const allowedKinds = new Set(['foundation', 'feature', 'logic', 'infra']);
const allowedModuleDirs = new Set(['ui', 'auth', 'core', 'telemetry']);
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
const packageExports = new Set(Object.keys(kitPackage.exports || {}));
const modules = Array.isArray(registry?.modules) ? registry.modules : [];

if (modules.length === 0) {
  fail('nimi-kit-registry.yaml: modules must not be empty');
}

const registeredModuleDirs = new Set();

for (const row of modules) {
  const id = String(row?.id || '').trim();
  const subpath = String(row?.subpath || '').trim();
  const kind = String(row?.kind || '').trim();
  const description = String(row?.description || '').trim();
  const sourceRule = String(row?.source_rule || '').trim();
  const admissionStatus = String(row?.admission_status || '').trim();
  const owner = String(row?.owner || '').trim();
  const dependencies = Array.isArray(row?.dependencies) ? row.dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const peerDependencies = Array.isArray(row?.peer_dependencies) ? row.peer_dependencies.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const exportsList = Array.isArray(row?.exports) ? row.exports.map((item) => String(item || '').trim()).filter(Boolean) : [];

  expect(id, 'nimi-kit-registry.yaml: module row missing id');
  expect(subpath.startsWith('/'), `nimi-kit-registry.yaml ${id}: subpath must start with /`);
  expect(allowedKinds.has(kind), `nimi-kit-registry.yaml ${id}: invalid kind ${kind}`);
  expect(description, `nimi-kit-registry.yaml ${id}: description is required`);
  expect(sourceRule, `nimi-kit-registry.yaml ${id}: source_rule is required`);
  expect(admissionStatus, `nimi-kit-registry.yaml ${id}: admission_status is required`);
  expect(owner, `nimi-kit-registry.yaml ${id}: owner is required`);
  expect(Array.isArray(row?.dependencies), `nimi-kit-registry.yaml ${id}: dependencies must be an array`);
  expect(Array.isArray(row?.peer_dependencies), `nimi-kit-registry.yaml ${id}: peer_dependencies must be an array`);
  expect(exportsList.length > 0, `nimi-kit-registry.yaml ${id}: exports must not be empty`);

  const moduleDir = subpath.replace(/^\//, '').split('/')[0] || '';
  expect(allowedModuleDirs.has(moduleDir), `nimi-kit-registry.yaml ${id}: unsupported module dir ${moduleDir}`);
  registeredModuleDirs.add(moduleDir);

  const absModuleDir = path.join(kitRoot, moduleDir);
  expect(fs.existsSync(absModuleDir), `registered module missing from disk: kit/${moduleDir}`);
  expect(!fs.existsSync(path.join(absModuleDir, 'package.json')), `kit/${moduleDir}: nested package.json is forbidden in single-package kit`);
  expect(!fs.existsSync(path.join(absModuleDir, 'tsconfig.json')), `kit/${moduleDir}: nested tsconfig.json should be consolidated at kit/tsconfig.json`);

  for (const key of exportsList) {
    expect(packageExports.has(key), `nimi-kit-registry.yaml ${id}: export ${key} missing from kit/package.json`);
  }

  if (kind === 'foundation') {
    expect(dependencies.length === 0, `${id}: foundation module must not depend on other kit modules`);
  }
  if (kind === 'logic' || kind === 'infra') {
    expect(dependencies.length === 0, `${id}: ${kind} module must not declare runtime kit dependencies`);
  }
  if (kind === 'feature') {
    expect(peerDependencies.includes('react'), `${id}: feature module must declare react peer dependency`);
  }
}

for (const entry of fs.readdirSync(kitRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  if (!allowedModuleDirs.has(entry.name)) {
    continue;
  }
  if (!registeredModuleDirs.has(entry.name)) {
    fail(`on-disk kit module is unregistered: kit/${entry.name}`);
  }
}

for (const moduleDir of registeredModuleDirs) {
  const absDir = path.join(kitRoot, moduleDir);
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
