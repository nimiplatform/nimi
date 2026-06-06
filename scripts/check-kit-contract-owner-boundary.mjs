#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const featureModelConfigRoot = path.join(repoRoot, 'kit', 'features', 'model-config', 'src');
const coreModelConfigRoot = path.join(repoRoot, 'kit', 'core', 'src', 'model-config');
const bindingHelpersPath = path.join(featureModelConfigRoot, 'binding-helpers.ts');
const targetRefOwnerPath = path.join(coreModelConfigRoot, 'target-ref.ts');
const targetRefTypesPath = path.join(coreModelConfigRoot, 'types.ts');
const targetRefIndexPath = path.join(coreModelConfigRoot, 'index.ts');
const checkedExtensions = new Set(['.ts', '.tsx']);
const ignoredDirectories = new Set(['dist', 'generated', 'gen', 'node_modules']);
const violations = [];

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walkFiles(absPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    files.push(absPath);
  }
  return files;
}

function read(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function requireMatch(absPath, pattern, message) {
  if (!pattern.test(read(absPath))) {
    violations.push(`${rel(absPath)}: ${message}`);
  }
}

const targetRefHelpers = [
  'selectRequirementDescriptors',
  'readModelConfigTargetRef',
  'hasModelConfigTargetRef',
  'summarizeTargetRef',
  'applyModelConfigCapabilityPatch',
];

requireMatch(
  targetRefTypesPath,
  /\bexport\s+type\s+ModelConfigTargetRef\s*=\s*NimiAIConfigTargetRef\b/u,
  'ModelConfigTargetRef must be owned as a NimiAIConfigTargetRef alias in kit/core/model-config/types.ts',
);

for (const helper of targetRefHelpers) {
  requireMatch(
    targetRefOwnerPath,
    new RegExp(`\\bexport\\s+function\\s+${helper}\\b`, 'u'),
    `${helper} must be implemented by kit/core/model-config/target-ref.ts`,
  );
  requireMatch(
    targetRefIndexPath,
    new RegExp(`\\b${helper}\\b`, 'u'),
    `${helper} must be exported by kit/core/model-config/index.ts`,
  );
}

const expectedFeatureReexport = /^export\s+\{\s*summarizeTargetRef,\s*\}\s+from\s+['"]@nimiplatform\/kit\/core\/model-config['"];\s*$/su;
if (!expectedFeatureReexport.test(read(bindingHelpersPath))) {
  violations.push(`${rel(bindingHelpersPath)}: feature target-ref helpers must remain a thin core re-export`);
}

for (const filePath of walkFiles(featureModelConfigRoot)) {
  const fileRel = rel(filePath);
  const source = read(filePath);

  if (/\bcapabilities\s*\.\s*selectedBindings\b/u.test(source) || /\bselectedBindings\b/u.test(source)) {
    violations.push(`${fileRel}: selectedBindings must not return to model-config feature source`);
  }

  if (/\b(?:export\s+)?type\s+ModelConfigTargetRef\s*=/u.test(source)) {
    if (!/\bexport\s+type\s+\{\s*ModelConfigTargetRef\s*\}\s+from\s+['"]@nimiplatform\/kit\/core\/model-config['"]/u.test(source)) {
      violations.push(`${fileRel}: ModelConfigTargetRef type alias must not be declared in feature source`);
    }
  }

  if (/\b(?:export\s+)?interface\s+ModelConfigTargetRef\b/u.test(source)) {
    violations.push(`${fileRel}: ModelConfigTargetRef interface must not be declared in feature source`);
  }

  if (/\bRuntimeRouteBinding\b/u.test(source)) {
    violations.push(`${fileRel}: feature model-config must consume compact target refs, not RuntimeRouteBinding directly`);
  }

  for (const helper of targetRefHelpers) {
    const declarationPattern = new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${helper}\\b|\\b(?:export\\s+)?const\\s+${helper}\\s*=`, 'u');
    if (declarationPattern.test(source)) {
      violations.push(`${fileRel}: ${helper} implementation must stay in kit/core/model-config/target-ref.ts`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Kit contract owner boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Kit contract owner boundary check passed\n');
}
