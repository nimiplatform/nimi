#!/usr/bin/env node
import { failWith, pass, requireText } from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'descriptor-bridge.ready-lifecycle-resets',
]);
const failures = [
  ...requireText('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs', [
    'PageLoadEvent::Started',
    'WindowEvent::Destroyed',
    'RunEvent::ExitRequested',
    'set_desktop_open_intent_ready(app_handle, false)',
    'runtime.set_ready(ready)',
    'desktop_open_intent_set_ready',
  ]),
  ...requireText('apps/desktop/src/shell/renderer/infra/desktop-open/desktop-open-intent-listener.ts', [
    'listenTauri',
    'desktop-open://open-intent',
    'setDesktopOpenIntentReady(true)',
    'setDesktopOpenIntentReady(false)',
    'DESKTOP_OPEN_READY_HEARTBEAT_INTERVAL_MS',
    'globalThis.setInterval',
    'globalThis.clearInterval',
  ]),
  ...requireText('apps/desktop/src-tauri/src/desktop_open_intent.rs', [
    'desktop-open-desktop-not-ready',
    'wait_for_desktop_ready',
    'RENDERER_READY_HEARTBEAT_TTL_MS',
    'last_ready_heartbeat',
    'is_desktop_open_ready',
  ]),
];
if (guardInvariants.size !== 1) {
  failures.push('desktop open ready lifecycle acceptance assertion registry drifted');
}

failWith('Desktop Open ready lifecycle guard failed.', failures);
pass('desktop open ready lifecycle guard passed');
