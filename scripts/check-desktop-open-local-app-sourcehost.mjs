#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { failWith, parseYaml, pass, requireText } from './lib/desktop-open-checks.mjs';

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
  ...requireText('kit/shell/electron/src/main/desktop-open.ts', [
    'NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID',
    "return 'desktop-electron-local-app-host';",
  ]),
];
const capabilityCatalog = parseYaml('.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml');
const localAppCapabilitySet = capabilityCatalog.capability_sets?.find(
  (entry) => entry?.set_id === 'local-app-standard-shell-v1',
);
if (!localAppCapabilitySet?.allowed_operations?.includes('desktop-open.openIntent')) {
  failures.push('local-app-standard-shell-v1 does not admit desktop-open.openIntent');
}
if (localAppCapabilitySet?.planned_operations?.includes('desktop-open.openIntent')) {
  failures.push('desktop-open.openIntent remains planned after local-app admission');
}
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

const kitTestResult = spawnSync('pnpm', [
  '--filter', '@nimiplatform/kit', 'exec', 'vitest', 'run',
  '--config', 'ui/vitest.config.ts',
  'shell/electron/test/electron-desktop-open.test.ts',
], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (kitTestResult.status !== 0) {
  process.exit(kitTestResult.status ?? 1);
}

pass('desktop open local-app sourceHost guard passed');
