#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const packageJsonPath = path.join(kitRoot, 'package.json');
const violations = [];

function fail(message) {
  violations.push(message);
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function listFilesRecursively(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['dist', 'node_modules', 'target'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(abs, predicate));
    } else if (!predicate || predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function resolvePackageExportTarget(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    for (const condition of ['import', 'default', 'require', 'types']) {
      if (typeof value[condition] === 'string') return value[condition].trim();
    }
  }
  return '';
}

function packageExportTargetToSourceTarget(exportTarget) {
  const normalized = String(exportTarget || '').trim();
  if (!normalized.startsWith('./dist/')) return normalized;

  const distRelative = normalized
    .replace(/^\.\//u, '')
    .replace(/^dist\//u, '')
    .replace(/\.d\.cts$/u, '')
    .replace(/\.d\.ts$/u, '')
    .replace(/\.cjs$/u, '')
    .replace(/\.js$/u, '');

  let candidate;
  if (distRelative.startsWith('features/')) {
    const parts = distRelative.split('/');
    candidate = `./${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`;
  } else if (distRelative.startsWith('shell/')) {
    const parts = distRelative.split('/');
    candidate = `./${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`;
  } else if (distRelative.startsWith('telemetry/')) {
    candidate = `./telemetry/src/${distRelative.replace(/^telemetry\//u, '')}`;
  } else {
    const [root, ...rest] = distRelative.split('/');
    candidate = `./${root}/src/${rest.join('/')}`;
  }

  for (const extension of ['', '.ts', '.tsx', '.cts', '.css']) {
    const withExtension = candidate.endsWith('.css') ? candidate : `${candidate}${extension}`;
    if (fs.existsSync(path.join(kitRoot, withExtension.replace(/^\.\//u, '')))) {
      return withExtension;
    }
  }
  return normalized;
}

function extractImportTargets(content) {
  return [
    ...content.matchAll(/from\s+['"]([^'"]+)['"]/gu),
    ...content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].map((match) => String(match[1] || '').trim()).filter(Boolean);
}

function declaredCssVariables(content) {
  return [...content.matchAll(/(^|\s)(--[a-zA-Z0-9_-]+)\s*:/gmu)]
    .map((match) => String(match[2] || ''));
}

function isTestOrToolingFile(fileRel) {
  return /(?:^|\/)(?:test|tests|__tests__)\//u.test(fileRel)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(fileRel)
    || /\/(?:vitest|vite|eslint)\.config\.[cm]?[jt]s$/u.test(fileRel);
}

function isNodeOrHostImport(target) {
  return target.startsWith('node:')
    || target === 'electron'
    || target.startsWith('electron/')
    || target.startsWith('@tauri-apps/')
    || ['fs', 'path', 'child_process', 'os'].includes(target);
}

if (!fs.existsSync(packageJsonPath)) {
  fail('kit/package.json is required');
} else {
  const kitPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageExports = kitPackage.exports;
  if (!packageExports || typeof packageExports !== 'object' || Array.isArray(packageExports)) {
    fail('kit/package.json: exports must be an object');
  } else {
    for (const [exportKey, target] of Object.entries(packageExports)) {
      const exportPath = resolvePackageExportTarget(target);
      if (!exportPath) {
        fail(`kit/package.json: export ${exportKey} must have a target`);
        continue;
      }
      if (!exportPath.startsWith('./dist/') || exportPath.includes('..')) {
        fail(`kit/package.json: export ${exportKey} must stay inside ./dist`);
        continue;
      }
      const sourceTarget = packageExportTargetToSourceTarget(exportPath);
      if (!fs.existsSync(path.join(kitRoot, sourceTarget.replace(/^\.\//u, '')))) {
        fail(`kit/package.json: export ${exportKey} points to missing source target ${sourceTarget}`);
      }
    }
  }
}

const sourceRoots = ['ui', 'auth', 'core', 'telemetry', 'features', 'shell']
  .map((entry) => path.join(kitRoot, entry));
const sourceFiles = sourceRoots.flatMap((root) =>
  listFilesRecursively(root, (absPath) => /\.(?:ts|tsx|cts|mts|css)$/u.test(absPath)));

for (const absPath of sourceFiles) {
  const fileRel = rel(absPath);
  const content = fs.readFileSync(absPath, 'utf8');
  const importTargets = extractImportTargets(content);
  const isTestOrTooling = isTestOrToolingFile(fileRel);

  if (content.includes('runtime/internal/')) {
    fail(`${fileRel}: Kit must not reference runtime/internal/**`);
  }

  for (const target of importTargets) {
    if (/^apps\//u.test(target) || /(^|\/)apps\//u.test(target)) {
      fail(`${fileRel}: Kit must not import app-layer code (${target})`);
    }
    if (/^@(renderer|runtime|app|desktop|web)(\/|$)/u.test(target)) {
      fail(`${fileRel}: Kit must not import app aliases (${target})`);
    }
    if (target.includes('runtime/internal/')) {
      fail(`${fileRel}: Kit must not import runtime internal code (${target})`);
    }
    if (
      !isTestOrTooling
      && (target === '@nimiplatform/sdk' || target.startsWith('@nimiplatform/sdk/'))
      && fileRel !== 'kit/core/src/sdk-contract.ts'
      && !fileRel.startsWith('kit/shell/electron/')
    ) {
      fail(`${fileRel}: SDK imports must route through kit/core/src/sdk-contract.ts (${target})`);
    }
  }

  if (fileRel.startsWith('kit/core/')) {
    if (/\.(?:css|scss|sass|less)['"]/u.test(content)) {
      fail(`${fileRel}: core must not import CSS`);
    }
    for (const target of importTargets) {
      if (target === 'react' || target.startsWith('react/')) {
        fail(`${fileRel}: core must not import React`);
      }
      if (target.includes('/ui') || target.includes('/auth') || target.includes('/telemetry')) {
        fail(`${fileRel}: core must not depend on Kit presentation modules (${target})`);
      }
    }
  }

  if (fileRel.startsWith('kit/telemetry/')) {
    for (const target of importTargets) {
      if (isNodeOrHostImport(target)) {
        fail(`${fileRel}: telemetry must remain renderer-safe (${target})`);
      }
    }
  }

  if (fileRel.startsWith('kit/features/')) {
    for (const target of importTargets) {
      if (target.startsWith('@tauri-apps/') || target === 'electron' || target.startsWith('electron/')) {
        fail(`${fileRel}: feature modules must not import platform bridges (${target})`);
      }
    }
  }

  if (fileRel.startsWith('kit/shell/renderer/') && !isTestOrTooling) {
    for (const target of importTargets) {
      if (target === 'electron' || target.startsWith('electron/') || target.includes('/shell/electron')) {
        fail(`${fileRel}: shell/renderer must remain host-neutral (${target})`);
      }
    }
  }

  if (fileRel.startsWith('kit/shell/capabilities/') && !isTestOrTooling) {
    for (const target of importTargets) {
      if (target === 'react' || target.startsWith('react/') || isNodeOrHostImport(target)) {
        fail(`${fileRel}: shell/capabilities must remain host-neutral contract code (${target})`);
      }
    }
  }

  if (fileRel.startsWith('kit/shell/electron/')) {
    for (const target of importTargets) {
      if (target === 'react' || target.startsWith('react/')) {
        fail(`${fileRel}: shell/electron must not import renderer code (${target})`);
      }
      if (target.startsWith('@tauri-apps/')) {
        fail(`${fileRel}: shell/electron must not import Tauri bridge code (${target})`);
      }
    }
    if (/ipcRenderer\s*[,}]/u.test(content) || /from\s+['"]electron['"]/u.test(content)) {
      fail(`${fileRel}: shell/electron must use injected host adapters instead of raw Electron primitives`);
    }
  }
}

for (const absPath of listFilesRecursively(path.join(kitRoot, 'auth'), (candidate) => candidate.endsWith('.css'))) {
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
