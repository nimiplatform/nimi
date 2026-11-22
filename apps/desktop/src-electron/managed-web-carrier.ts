import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import {
  parseManagedWebCarrierArguments,
  startManagedWebCarrier,
} from './managed-web-carrier-runtime.js';

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean | undefined;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(currentDir, 'managed-web-preload.cjs');
// Electron sets app.isPackaged=true whenever the binary is renamed away from
// `electron.exe` (such as `.nimi/local/dev-carrier/win32-x64/NimiAppHost.exe`),
// so bind leading-script acceptance to the compile-time build mode.
const allowLeadingScriptArgument = typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ === 'boolean'
  ? __NIMI_ELECTRON_DEVELOPMENT_BUILD__
  : !app.isPackaged;

try {
  const launch = parseManagedWebCarrierArguments({
    argv: process.argv,
    workingDirectory: process.cwd(),
    allowLeadingScriptArgument,
  });
  startManagedWebCarrier({ launch, preloadPath });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[nimi-managed-web-carrier] launch rejected: ${message}\n`);
  app.exit(78);
}
