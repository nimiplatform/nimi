#!/usr/bin/env node
import {
  collectFiles,
  failWith,
  findPatternViolations,
  pass,
  read,
} from './lib/desktop-open-checks.mjs';

const files = collectFiles([
  'apps/zhiyu/src',
  'apps/desktop/src/shell/renderer',
  'kit/shell/renderer/src',
  'kit/shell/electron/src',
]);

const failures = findPatternViolations(files, [
  /openExternalUrl\([^)]*desktop/iu,
  /webbrowser::open/u,
  /tauri_plugin_single_instance/u,
  /single-instance/u,
  /nimi-desktop:\/\//u,
]);

const desktopBridge = read('apps/desktop/src-tauri/src/desktop_open_intent.rs');
if (!desktopBridge.includes('TcpListener::bind("127.0.0.1:0")')) {
  failures.push('Desktop bridge must bind exact 127.0.0.1:0 loopback');
}
if (desktopBridge.includes('0.0.0.0') || desktopBridge.includes('[::]:')) {
  failures.push('Desktop bridge must not bind wildcard addresses');
}
if (read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs').includes('DeepLinkOpenTabPayload')) {
  failures.push('old deep-link runtime-config payload is still active');
}

failWith('Desktop Open transport hard-cut guard failed.', failures);
pass('desktop open transport hard-cut guard passed');
