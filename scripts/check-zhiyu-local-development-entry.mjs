#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function collectZhiyuLocalDevelopmentEntryViolations(sources) {
  const violations = [];
  requirePattern(sources.contract, /if \(!input\.localDevelopment\)[\s\S]*input\.selector !== undefined[\s\S]*forbidden outside local development/u, 'non-dev selector must fail closed', violations);
  requirePattern(sources.contract, /if \(input\.selector === undefined\) \{\s*return undefined;\s*\}/u, 'zero-selector local development must be accepted', violations);
  requirePattern(sources.contract, /LOCAL_AGENT_ID_PATTERN\.test\(selector\)[\s\S]*selector is invalid/u, 'invalid selector must fail closed', violations);
  requirePattern(sources.main, /readArgument\('--nimi-dev-renderer-url'\)[\s\S]*resolveZhiyuLocalDevelopmentAgentId/u, 'renderer URL must activate the shared selector contract', violations);
  requirePattern(sources.main, /localDevelopmentPreloadArguments[\s\S]*LOCAL_DEVELOPMENT_PRELOAD_MARKER[\s\S]*localDevelopmentAgentId \? \[`--nimi-dev-agent-id=/u, 'main must omit the optional selector when absent', violations);
  requirePattern(sources.preload, /resolveZhiyuLocalDevelopmentAgentId[\s\S]*exposeInMainWorld\('__nimiZhiyuLocalDevelopment'[\s\S]*isolated-local-development/u, 'preload must expose the bounded local-development shape', violations);
  requirePattern(sources.app, /if \(localDevelopment\?\.agentId\)[\s\S]*ZhiyuLocalDevelopmentJourney[\s\S]*return <ZhiyuBundledApp \/>/u, 'zero selector must route to bundled UI', violations);
  requirePattern(sources.inventory, /reasonCode: 'local-app-agent-inventory-unavailable'[\s\S]*actionHint: 'request_bounded_local_app_agent_inventory_authority'/u, 'bundled local development must expose the exact inventory fail-closed state', violations);
  requirePattern(sources.account, /window\.__nimiZhiyuLocalDevelopment[\s\S]*zhiyuLocalAppRuntimePlatform\.auth\.status\(\)[\s\S]*source: 'local-app\.sessionStatus'[\s\S]*accountId: null/u, 'local development account state must use bounded sessionStatus without account projection', violations);
  requirePattern(sources.platform, /createNimiAppRuntimePlatformClient[\s\S]*createNimiLocalAppStandardShellSurface/u, 'local development must use SDK and Kit public surfaces', violations);
  if (/fetch\(|axios|127\.0\.0\.1:|localhost:/u.test(sources.platform)) {
    violations.push('local development platform must not contain an app-level network bypass');
  }
  return violations;
}

async function readSources() {
  const files = {
    contract: 'apps/zhiyu/src-electron/local-development-contract.ts',
    main: 'apps/zhiyu/src-electron/main.ts',
    preload: 'apps/zhiyu/src-electron/preload.cts',
    app: 'apps/zhiyu/src/shell/app/App.tsx',
    inventory: 'apps/zhiyu/src/shell/agent/agent-inventory.ts',
    account: 'apps/zhiyu/src/shell/auth/runtime-account-status.ts',
    platform: 'apps/zhiyu/src/shell/local-development/local-app-runtime-platform.ts',
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [
    key,
    await readFile(path.join(repoRoot, relativePath), 'utf8'),
  ])));
}

function requirePattern(source, pattern, message, violations) {
  if (!pattern.test(source)) violations.push(message);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const violations = collectZhiyuLocalDevelopmentEntryViolations(await readSources());
  if (violations.length > 0) {
    process.stderr.write(`Zhiyu local-development entry violations:\n- ${violations.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Zhiyu local-development entry check passed\n');
  }
}
