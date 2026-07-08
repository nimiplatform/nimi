#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { failWith, pass, requireText } from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'product.installed-app-host-source-host-is-explicit',
  'owner.installed-app-source-host',
]);
const failures = [
  ...requireText('.nimi/spec/platform/kernel/desktop-open-intent-contract.md', [
    'desktop-electron-installed-app-host',
  ]),
  ...requireText('sdks/typescript/core/app/desktop-open.ts', [
    'desktop-electron-installed-app-host',
  ]),
  ...requireText('kit/shell/electron/src/main/desktop-open.ts', [
    'NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID',
    'desktop-electron-installed-app-host',
  ]),
  ...requireText('kit/shell/capabilities/src/catalog.ts', [
    'installed-nimi-app-standard-shell-v1',
    'desktop-open.openIntent',
  ]),
  ...requireText('kit/shell/electron/test/electron-desktop-open.test.ts', [
    'desktop-electron-installed-app-host',
  ]),
];
if (guardInvariants.size !== 2) {
  failures.push('desktop open installed-host acceptance assertion registry drifted');
}

failWith('Desktop Open installed-host sourceHost guard failed.', failures);

const testResult = spawnSync('pnpm', [
  '--dir',
  'kit',
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.config.ts',
  'shell/electron/test/electron-desktop-open.test.ts',
  '-t',
  'installed app hosts',
], { stdio: 'inherit' });
if (testResult.status !== 0) {
  process.exit(testResult.status ?? 1);
}

pass('desktop open installed-host sourceHost guard passed');
