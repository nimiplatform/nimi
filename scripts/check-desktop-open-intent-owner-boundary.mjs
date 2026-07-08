#!/usr/bin/env node
import {
  collectFiles,
  failWith,
  findPatternViolations,
  pass,
  read,
} from './lib/desktop-open-checks.mjs';

const failures = [];
const sdkFiles = collectFiles(['sdks/typescript/core/app']);
failures.push(...findPatternViolations(sdkFiles, [
  /from ['"]@nimiplatform\/kit/u,
  /import\(['"]@nimiplatform\/kit/u,
  /from ['"][^'"]*(?:electron|tauri)/u,
  /import\(['"][^'"]*(?:electron|tauri)/u,
  /window\./u,
  /openExternalUrl\(/u,
]));

const kitCoreFiles = collectFiles(['kit/core/src']);
failures.push(...findPatternViolations(kitCoreFiles, [
  /from ['"][^'"]*(?:apps\/desktop|apps\/zhiyu|react|electron|tauri)/u,
  /import\(['"][^'"]*(?:apps\/desktop|apps\/zhiyu|react|electron|tauri)/u,
]));

const desktopNavigation = read('apps/desktop/src/shell/renderer/infra/desktop-open/desktop-open-intent-navigation.ts');
for (const ownedState of ['setExploreActiveSection', 'dispatchRuntimeConfigOpenPage', 'dispatchSettingsOpenSection', 'setAppsDetailAppId']) {
  if (!desktopNavigation.includes(ownedState)) {
    failures.push(`Desktop renderer navigation missing owner state action ${ownedState}`);
  }
}

failWith('Desktop Open owner-boundary guard failed.', failures);
pass('desktop open owner-boundary guard passed');
