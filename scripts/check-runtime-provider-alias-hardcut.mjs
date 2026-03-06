#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const scenarioMediaHelpersPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'scenario_media_helpers.go');
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

function main() {
  const scenarioSource = readText(scenarioMediaHelpersPath);
  const cloudSource = readText(cloudProviderPath);
  const liveUtilsSource = readText(liveProviderUtilsPath);

  for (const [alias, provider] of rejectOnlyAliases.entries()) {
    const routedPattern = new RegExp(`"${alias}"\\s*:`);
    if (routedPattern.test(scenarioSource)) {
      fail(`runtime/internal/services/ai/scenario_media_helpers.go must not route legacy alias ${alias}`);
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
