#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';
import { DIST_ROOT } from './paths.mjs';
import {
  assetClassesFromFileList,
  generateSimulatorCsp,
  simulatorCspSatisfiesFloor,
} from '../src/effects/csp.ts';

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/,
  /NIMI_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)/,
];

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function collectFiles(rootDir, relativeDir = '') {
  const rows = [];
  for (const entry of readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) rows.push(...collectFiles(rootDir, relativePath));
    else if (entry.isFile()) rows.push(relativePath);
    else fail('SIM_BUILD_FILE_KIND', 'build output contains a non-file entry', relativePath);
  }
  return rows.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function assertCredentialFree(relativePath, bytes) {
  const text = bytes.toString('utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) fail('SIM_BUILD_SECRET', `credential-shaped output matched ${pattern}`, relativePath);
  }
  if (/import\.meta\.env\s*\[|process\.env\s*\[/.test(text)) {
    fail('SIM_BUILD_WILDCARD_ENV', 'build output contains wildcard environment access', relativePath);
  }
}

function finalizeCsp(files) {
  const generatedPolicy = generateSimulatorCsp(assetClassesFromFileList(files));
  const indexHtmlPath = path.join(DIST_ROOT, 'index.html');
  const indexHtml = readFileSync(indexHtmlPath, 'utf8');
  const prefix = '<meta http-equiv="Content-Security-Policy" content="';
  const start = indexHtml.indexOf(prefix);
  if (start === -1) fail('SIM_BUILD_CSP_MISSING', 'built index.html must carry the CSP meta template');
  const valueStart = start + prefix.length;
  const valueEnd = indexHtml.indexOf('"', valueStart);
  if (valueEnd === -1) fail('SIM_BUILD_CSP_MISSING', 'built index.html CSP meta template is malformed');
  const restrictiveTemplate = generateSimulatorCsp({
    script: false,
    style: false,
    image: false,
    font: false,
    media: false,
  });
  if (indexHtml.slice(valueStart, valueEnd) !== restrictiveTemplate) {
    fail('SIM_BUILD_CSP_TEMPLATE_DRIFT', 'source CSP template must remain at the restrictive baseline');
  }
  const output = `${indexHtml.slice(0, valueStart)}${generatedPolicy}${indexHtml.slice(valueEnd)}`;
  writeFileSync(indexHtmlPath, output);
  if (!simulatorCspSatisfiesFloor(generatedPolicy)) {
    fail('SIM_BUILD_CSP_FLOOR', 'emitted index.html CSP does not satisfy the restrictive floor');
  }
}

function assertGuardFirstBoundary() {
  const manifest = JSON.parse(readFileSync(path.join(DIST_ROOT, 'vite-manifest.json'), 'utf8'));
  const entryChunk = manifest['index.html'];
  if (!entryChunk?.isEntry) fail('SIM_BUILD_ENTRY', 'Vite manifest has no index entry chunk');
  if (Array.isArray(entryChunk.imports) && entryChunk.imports.length > 0) {
    fail('SIM_BUILD_GUARD_BOUNDARY', `entry chunk statically imports ${entryChunk.imports.join(', ')}`);
  }
  const dynamicImports = entryChunk.dynamicImports ?? [];
  const dynamicImportSources = dynamicImports.map((entry) => {
    const row = manifest[entry]
      ?? Object.values(manifest).find((candidate) => candidate?.file === entry);
    if (row?.src) return row.src;
    if (row?.isDynamicEntry === true && row?.name === 'mount') return 'src/shell/mount.ts';
    return entry;
  });
  if (dynamicImportSources.length !== 1 || dynamicImportSources[0] !== 'src/shell/mount.ts') {
    fail('SIM_BUILD_GUARD_BOUNDARY', `entry chunk dynamic imports drifted: ${dynamicImportSources.join(', ')}`);
  }
}

const files = collectFiles(DIST_ROOT);
finalizeCsp(files);
assertGuardFirstBoundary();
for (const relativePath of files) {
  assertCredentialFree(relativePath, readFileSync(path.join(DIST_ROOT, ...relativePath.split('/'))));
}
process.stdout.write(`simulator-build: finalized ${files.length} files\n`);
