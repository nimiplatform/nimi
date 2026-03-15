#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, relative } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scanRoots = [
  'runtime/internal',
  'runtime/cmd',
  'apps/desktop/src-tauri/src/runtime_bridge',
  'sdk/src',
  'runtime/README.md',
  'docs/getting-started/index.md',
];

const allowedExtensions = new Set([
  '.go',
  '.rs',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.md',
  '.yaml',
  '.yml',
  '.proto',
]);

const allowedLegacyCloudNameFiles = new Set([
  'runtime/cmd/runtime-compliance/main.go',
]);

const genericChecks = [
  {
    label: 'legacy cloud adapter env key',
    pattern: /NIMI_RUNTIME_CLOUD_ADAPTER_[A-Z0-9_]+/g,
  },
  {
    label: 'legacy runtime config path',
    pattern: /\.nimi\/runtime\/config\.json/g,
  },
  {
    label: 'legacy config migrate command',
    pattern: /\bnimi config migrate\b/g,
  },
];

const legacyCloudNamePattern = /\b(?:litellm|cloudlitellm|cloudai)\b/ig;

const failures = [];

function isTestFile(relPath) {
  return relPath.endsWith('_test.go')
    || relPath.endsWith('.test.ts')
    || relPath.endsWith('.test.tsx')
    || relPath.endsWith('.spec.ts')
    || relPath.endsWith('.spec.tsx');
}

function walk(absPath) {
  const entryStat = statSync(absPath);
  if (entryStat.isDirectory()) {
    for (const name of readdirSync(absPath)) {
      walk(resolve(absPath, name));
    }
    return;
  }

  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  if (isTestFile(relPath)) {
    return;
  }

  if (!allowedExtensions.has(extname(absPath))) {
    return;
  }

  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';

    for (const check of genericChecks) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(line)) {
        failures.push(`${relPath}:${i + 1}: ${check.label}: ${line.trim()}`);
      }
    }

    if (!allowedLegacyCloudNameFiles.has(relPath)) {
      legacyCloudNamePattern.lastIndex = 0;
      if (legacyCloudNamePattern.test(line)) {
        failures.push(`${relPath}:${i + 1}: legacy cloud provider naming is forbidden: ${line.trim()}`);
      }
    }
  }
}

function listRuntimeAIRouteFiles() {
  const aiRoot = resolve(repoRoot, 'runtime/internal/services/ai');
  const out = [];

  function visit(absPath) {
    const entryStat = statSync(absPath);
    if (entryStat.isDirectory()) {
      for (const name of readdirSync(absPath)) {
        visit(resolve(absPath, name));
      }
      return;
    }

    const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
    const baseName = relPath.split('/').pop() || '';
    if (!baseName.endsWith('.go') || baseName.endsWith('_test.go')) {
      return;
    }
    if (!baseName.startsWith('provider') && !baseName.startsWith('scenario_')) {
      return;
    }
    out.push(relPath);
  }

  visit(aiRoot);
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function checkNoLegacyAliasAcceptance() {
  const cloudProviderPath = resolve(repoRoot, 'runtime/internal/nimillm/cloud_provider.go');
  const cloudProviderContent = readFileSync(cloudProviderPath, 'utf8');
  const prefixBuilderMatch = cloudProviderContent.match(/func\s+buildPrefixToProvider\(\)\s+map\[string\]string\s*\{([\s\S]*?)\n\}/m);
  if (!prefixBuilderMatch) {
    failures.push('runtime/internal/nimillm/cloud_provider.go: failed to locate buildPrefixToProvider function');
  } else {
    const legacyPrefixInCanonicalMap = /"(?:alibaba|aliyun|bytedance|byte|moonshot|zhipu|bigmodel)"/.test(prefixBuilderMatch[1]);
    if (legacyPrefixInCanonicalMap) {
      failures.push('runtime/internal/nimillm/cloud_provider.go: buildPrefixToProvider must not accept legacy provider prefixes');
    }
  }

  const probePath = resolve(repoRoot, 'runtime/internal/nimillm/cloud_provider_probe.go');
  const probeContent = readFileSync(probePath, 'utf8');
  const probeLegacyCases = /case\s+"(?:alibaba|aliyun|bytedance|byte|moonshot|zhipu|bigmodel|cloudnimillm|cloudalibaba|cloudbytedance|cloudgemini|cloudminimax|cloudkimi|cloudglm|clouddeepseek|cloudopenrouter)"/.test(probeContent);
  if (probeLegacyCases) {
    failures.push('runtime/internal/nimillm/cloud_provider_probe.go: NormalizeTokenProviderID must reject legacy aliases');
  }

  const routeFiles = listRuntimeAIRouteFiles();
  const routeLegacyPattern = /(aliyun\/|alibaba\/|bytedance\/|byte\/|moonshot\/|zhipu\/|bigmodel\/)/;
  for (const relPath of routeFiles) {
    const absPath = resolve(repoRoot, relPath);
    const content = readFileSync(absPath, 'utf8');
    if (routeLegacyPattern.test(content)) {
      failures.push(`${relPath}: legacy model-id prefixes must not be accepted in routing logic`);
    }
  }
  if (routeFiles.length === 0) {
    failures.push('runtime/internal/services/ai: failed to locate scenario routing files for legacy prefix verification');
  }
}

for (const root of scanRoots) {
  walk(resolve(repoRoot, root));
}

checkNoLegacyAliasAcceptance();

if (failures.length > 0) {
  process.stderr.write(`legacy cloud/provider/config contracts are forbidden:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('legacy cloud/provider/config contract check passed\n');
}
