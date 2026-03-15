#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const runtimeAIServicePath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai');
const cloudProviderPath = path.join(repoRoot, 'runtime', 'internal', 'nimillm', 'cloud_provider.go');
const liveProviderUtilsPath = path.join(repoRoot, 'scripts', 'live-provider-utils.mjs');

const rejectOnlyAliases = new Map([
  ['alibaba', 'dashscope'],
  ['aliyun', 'dashscope'],
  ['bytedance', 'volcengine'],
  ['byte', 'volcengine'],
  ['moonshot', 'kimi'],
  ['zhipu', 'glm'],
  ['bigmodel', 'glm'],
]);

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function listRuntimeAIRouteFiles(absDir) {
  const out = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRuntimeAIRouteFiles(absPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.go') || entry.name.endsWith('_test.go')) {
      continue;
    }
    if (!entry.name.startsWith('provider') && !entry.name.startsWith('scenario_')) {
      continue;
    }
    out.push(absPath);
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function main() {
  const runtimeAIRouteFiles = listRuntimeAIRouteFiles(runtimeAIServicePath);
  if (runtimeAIRouteFiles.length === 0) {
    fail('runtime/internal/services/ai must keep provider/scenario routing files for alias hardcut checks');
  }
  const routingSources = runtimeAIRouteFiles.map((absPath) => ({
    relPath: path.relative(repoRoot, absPath).replaceAll('\\', '/'),
    source: readText(absPath),
  }));
  const cloudSource = readText(cloudProviderPath);
  const liveUtilsSource = readText(liveProviderUtilsPath);

  for (const [alias, provider] of rejectOnlyAliases.entries()) {
    const routedPattern = new RegExp(`"${alias}"\\s*:`);
    for (const routeSource of routingSources) {
      if (routedPattern.test(routeSource.source)) {
        fail(`${routeSource.relPath} must not route legacy alias ${alias}`);
      }
    }

    const rejectPattern = new RegExp(`"${alias}"\\s*:\\s*"${provider}"`);
    if (!rejectPattern.test(cloudSource)) {
      fail(`runtime/internal/nimillm/cloud_provider.go must keep reject-only alias mapping ${alias} -> ${provider}`);
    }

    const liveAliasPattern = new RegExp(`\\b${alias}\\s*:`);
    if (liveAliasPattern.test(liveUtilsSource)) {
      fail(`scripts/live-provider-utils.mjs must not normalize legacy alias ${alias}`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-alias-hardcut: OK');
}

main();
