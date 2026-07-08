#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  failWith,
  pass,
  read,
  requireText,
} from './lib/desktop-open-checks.mjs';

const guardInvariants = new Set([
  'state.stale-presence',
  'descriptor-bridge.descriptor-path-is-stable-host-control-root',
  'descriptor-bridge.descriptor-permissions-are-owner-only',
  'descriptor-bridge.descriptor-writes-are-atomic',
  'descriptor-bridge.symlink-substitution-fails-closed',
  'descriptor-bridge.token-material-is-redacted',
  'descriptor-bridge.endpoint-is-exact-loopback',
  'descriptor-bridge.pid-is-advisory-only',
  'descriptor-bridge.malformed-descriptor-fails-closed',
  'owner.presence-descriptor',
]);
const failures = [
  ...requireText('apps/desktop/src-tauri/src/desktop_open_intent.rs', [
    'PRESENCE_RELATIVE_PATH',
    '"run", "desktop", "open-intent", "presence.v1.json"',
    '0o700',
    '0o600',
    'reject_symlink_ancestry(parent',
    'reject_symlink_if_exists(path',
    'reject_descriptor_temp_symlinks(parent, path)',
    'descriptor_temp_path(path)',
    '.create_new(true)',
    'libc::O_NOFOLLOW',
    'replace_presence_descriptor_atomically(&temp_path, path)',
    'last_heartbeat_at',
    'desktop_open_presence_descriptor_replaces_existing_descriptor',
    'desktop_open_presence_descriptor_rejects_temp_symlink_before_token_write',
  ]),
  ...requireText('kit/shell/electron/src/main/desktop-open.ts', [
    "['.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json']",
    'assertNoDescriptorSymlink',
    'descriptorPathAncestors',
    'lastHeartbeatAt',
    'desktop-open-desktop-not-running',
    'Authorization',
  ]),
  ...requireText('kit/shell/tauri/src/standard_desktop_open.rs', [
    'assert_no_symlink_ancestry',
    'Desktop Open descriptor ancestry must not contain symlinks',
  ]),
];

const desktopSource = read('apps/desktop/src-tauri/src/desktop_open_intent.rs');
const electronSource = read('kit/shell/electron/src/main/desktop-open.ts');
if (desktopSource.includes('resolve_nimi_data_dir') || electronSource.includes('nimi_data')) {
  failures.push('presence descriptor must not use product nimi_data root');
}
if (/console\.(?:log|error|warn).*token/u.test(electronSource)) {
  failures.push('Electron Desktop Open host must not log descriptor token');
}
if (guardInvariants.size !== 10) {
  failures.push('desktop open presence acceptance assertion registry drifted');
}

failWith('Desktop Open presence security guard failed.', failures);

const cargoResult = spawnSync('cargo', [
  'test',
  '--manifest-path',
  'apps/desktop/src-tauri/Cargo.toml',
  'desktop_open_presence_descriptor',
  '--',
  '--nocapture',
], { stdio: 'inherit' });
if (cargoResult.status !== 0) {
  process.exit(cargoResult.status ?? 1);
}

pass('desktop open presence security guard passed');
