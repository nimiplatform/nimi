import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';

import { describeMacOSLocalAppHostFailure, resolveMacOSLocalAppHostLaunch } from './contract.mjs';
import { startManagedWebCarrier } from '../../dist-electron/managed-web-carrier-runtime.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = app.isPackaged
  ? path.join(currentDir, 'managed-web-preload.cjs')
  : path.resolve(currentDir, '../../dist-electron/managed-web-preload.cjs');

let stage = 'launch-contract';
try {
  const launch = resolveMacOSLocalAppHostLaunch({
    argv: process.argv,
    executable: process.execPath,
    hostProfileDirectory: process.env.NIMI_APP_HOST_PROFILE_DIR,
    uid: process.getuid?.(),
    workingDirectory: process.cwd(),
    allowLeadingScriptArgument: !app.isPackaged,
  });
  if (launch.mode === 'native-dev') {
    stage = 'app-import';
    await import(pathToFileURL(launch.mainEntry).href);
  } else if (launch.mode === 'managed-web-dev') {
    stage = 'managed-web-carrier';
    startManagedWebCarrier({
      launch: {
        mode: 'dev',
        workingDirectory: launch.workingDirectory,
        rendererOrigin: launch.rendererOrigin,
        ...(launch.cdpPort === undefined ? {} : { cdpPort: launch.cdpPort }),
      },
      preloadPath,
    });
  } else {
    stage = 'managed-web-carrier';
    startManagedWebCarrier({
      launch: {
        mode: 'installed',
        workingDirectory: launch.workingDirectory,
        payloadDigest: launch.payloadDigest,
      },
      preloadPath,
    });
  }
} catch (error) {
  const diagnostic = describeMacOSLocalAppHostFailure(error, stage, process.argv.length, app.isReady());
  process.stderr.write(`${diagnostic}\n`);
  // LaunchServices may discard inherited stderr. Keep the same bounded
  // diagnostic in the operating system log for installed Host failures.
  spawnSync('/usr/bin/logger', ['-t', 'Nimi Local App Host', diagnostic], { stdio: 'ignore', timeout: 1000 });
  app.exit(78);
}
