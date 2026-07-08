#!/usr/bin/env node
import {
  collectFiles,
  failWith,
  findPatternViolations,
  pass,
  read,
  requireText,
} from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'product.standard-is-running-only',
  'owner.not-running-behavior',
  'failure.nimi-desktop-in-app-code',
  'failure.external-menu-bar-open-tab-dispatch',
  'failure.desktop-launch-intent-or-desktop-launch-open-intent',
  'failure.legitimate-desktop-launched-nimi-app-vocabulary',
]);
const files = collectFiles([
  '.nimi/spec',
  'apps/desktop/src-tauri/src',
  'apps/desktop/src/shell/renderer',
  'kit',
  'sdks/typescript/core',
]);

const violations = findPatternViolations(files, [
  /\bDesktopLaunchIntent\b/u,
  /desktop-launch\.openIntent/u,
  /desktop-launch:\/\/open-intent/u,
], {
  allow: (relPath, line) => (
    relPath.includes('desktop-open') && line.includes('DesktopLaunchIntent') && line.includes('reject')
  ),
});

const failures = [
  ...violations,
  ...requireText('sdks/typescript/core/app/desktop-open.ts', [
    'DesktopOpenIntent',
    'desktop-electron-installed-app-host',
  ]),
  ...requireText('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs', [
    'start_desktop_open_intent_bridge',
  ]),
];

const bootstrap = read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
if (/MENU_BAR_OPEN_TAB_EVENT[\s\S]*DeepLinkOpenTabPayload/u.test(bootstrap)) {
  failures.push('app_bootstrap.rs still maps deep-link URLs to menu-bar navigation');
}
if (read('sdks/typescript/core/app/desktop-open.ts').includes('desktop-open-bridge-unavailable')) {
  failures.push('undefined v1 reason code desktop-open-bridge-unavailable is present in SDK');
}
if (read('apps/desktop/src-tauri/src/desktop_open_intent.rs').includes('desktop-open-host-unavailable')) {
  failures.push('Desktop bridge must not produce desktop-open-host-unavailable; use desktop-not-ready/not-running/auth/invalid codes');
}
if (guardInvariants.size !== 6) {
  failures.push('desktop open hard-cut acceptance assertion registry drifted');
}

failWith('Desktop Open hard-cut guard failed.', failures);
pass('desktop open hard-cut guard passed');
