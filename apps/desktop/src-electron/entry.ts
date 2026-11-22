import path from 'node:path';
import process from 'node:process';
import { app } from 'electron';

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// Zero static Home imports and zero pre-ready side effects: single-instance
// lock, Host profile setup, and privileged scheme registration remain owned
// exclusively by the dispatched entry module.
const executableName = path.basename(process.execPath).toLowerCase();

if (executableName === 'nimi.exe') {
  await import('./main.js');
} else if (executableName === 'nimiapphost.exe') {
  await import('./managed-web-carrier.js');
} else {
  process.stderr.write(`[nimi-entry] unrecognized executable basename: ${executableName}\n`);
  app.exit(78);
}
