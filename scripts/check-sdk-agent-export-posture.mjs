#!/usr/bin/env node

import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { collectRootExports, validateRegistry } from './lib/agent-export-posture-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const registryPath = path.join(
  repoRoot,
  '.nimi/spec/sdks/kernel/tables/agent-export-authority-posture.yaml',
);
const methodGroupsPath = path.join(
  repoRoot,
  '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
);

function collectSpecRuleIds() {
  const ruleIds = new Set();
  const headingPattern = /^#{2,3}\s+([A-Z]-[A-Z]+-\d+)\b/gm;
  for (const contractPath of globSync(path.join(repoRoot, '.nimi/spec/*/kernel/*.md'))) {
    const content = readFileSync(contractPath, 'utf8');
    for (const match of content.matchAll(headingPattern)) {
      ruleIds.add(match[1]);
    }
  }
  return ruleIds;
}

const registry = YAML.parse(readFileSync(registryPath, 'utf8'));
const methodGroups = YAML.parse(readFileSync(methodGroupsPath, 'utf8'));
const methodGroupIds = new Set((methodGroups.groups ?? []).map((group) => group.group));
const ruleIds = collectSpecRuleIds();
const enforcedRoots = (registry.coverage_roots ?? [])
  .filter((coverageRoot) => coverageRoot.status === 'enforced')
  .map((coverageRoot) => coverageRoot.root);

let failed = false;
for (const coverageRoot of registry.coverage_roots ?? []) {
  if (coverageRoot.status !== 'enforced') {
    continue;
  }
  const { exportsBySymbol, errors: collectErrors } = collectRootExports({
    rootDir: path.join(repoRoot, coverageRoot.root),
    entryFile: coverageRoot.entry,
    readFile: (filePath) => readFileSync(filePath, 'utf8'),
  });
  const { ok, errors } = validateRegistry({
    registry,
    rootExports: exportsBySymbol,
    collectErrors,
    root: coverageRoot.root,
    enforcedRoots,
    methodGroupIds,
    ruleIds,
    contractExists: (contractRelPath) => existsSync(path.join(repoRoot, '.nimi/spec', contractRelPath)),
  });
  if (!ok) {
    failed = true;
    console.error(`agent export authority posture check failed for ${coverageRoot.root}:`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
  } else {
    console.log(`agent export authority posture: ${coverageRoot.root} ok (${exportsBySymbol.size} public exports)`);
  }
}

if (failed) {
  process.exit(1);
}
