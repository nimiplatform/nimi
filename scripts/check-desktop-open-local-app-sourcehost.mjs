#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { failWith, pass, requireText } from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'product.local-app-host-source-host-is-explicit',
  'owner.local-app-source-host',
]);
const failures = [
  ...requireText('.nimi/spec/platform/kernel/desktop-open-intent-contract.md', [
    'desktop-electron-local-app-host',
  ]),
  ...requireText('.nimi/spec/platform/kernel/tables/desktop-open-intents.yaml', [
    'desktop-electron-local-app-host',
  ]),
  ...requireText('sdks/typescript/core/app/desktop-open.ts', [
    'desktop-electron-local-app-host',
  ]),
  ...requireText('apps/desktop/src-tauri/src/desktop_open_intent_parser.rs', [
    'desktop-electron-local-app-host',
  ]),
  ...requireText('apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs', [
    'owner.local-app-source-host',
    'desktop-electron-local-app-host',
    'local-app-standard-shell-v1',
  ]),
];
if (guardInvariants.size !== 2) {
  failures.push('desktop open local-app sourceHost acceptance assertion registry drifted');
}

failWith('Desktop Open local-app sourceHost guard failed.', failures);

const testResult = spawnSync(process.execPath, [
  '--test',
  'apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs',
], { stdio: 'inherit' });
if (testResult.status !== 0) {
  process.exit(testResult.status ?? 1);
}

pass('desktop open local-app sourceHost guard passed');
