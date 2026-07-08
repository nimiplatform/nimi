#!/usr/bin/env node
import { failWith, pass, read } from './lib/desktop-open-checks.mjs';

const capabilityCatalog = read('kit/shell/tauri/src/capabilities/catalog.rs');
const tauriApi = read('kit/shell/renderer/src/bridge/tauri-api.ts');
const commandRegistration = read('kit/shell/tauri/src/command_registration.rs');

const failures = [];
const admitsDesktopOpen = capabilityCatalog.includes('id: "desktop-open"')
  && capabilityCatalog.includes('command: "nimi.shell.desktopOpen.openIntent"');

if (admitsDesktopOpen) {
  if (!tauriApi.includes("[NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']]")) {
    failures.push('Tauri renderer command aliases admit desktop-open.openIntent but do not map it to a Rust command');
  }
  if (!commandRegistration.includes('desktop_open_intent_open_intent')) {
    failures.push('Tauri command registration admits desktop-open.openIntent but has no desktop_open_intent_open_intent descriptor');
  }
  if (!commandRegistration.includes('DESKTOP_OPEN_INTENT_COMMANDS')) {
    failures.push('Tauri command registration admits desktop-open.openIntent but does not include a Desktop Open command group');
  }
}

failWith('Desktop Open Tauri command drift guard failed.', failures);
pass('desktop open Tauri command drift guard passed');
