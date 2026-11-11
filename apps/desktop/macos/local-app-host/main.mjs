import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';

import { describeMacOSLocalAppHostFailure, resolveMacOSLocalAppHostLaunch } from './contract.mjs';

let stage = 'launch-contract';
try {
  const launch = resolveMacOSLocalAppHostLaunch({
    argv: process.argv,
    executable: process.execPath,
    hostProfileDirectory: process.env.NIMI_APP_HOST_PROFILE_DIR,
    uid: process.getuid?.(),
    workingDirectory: process.cwd(),
  });
  stage = 'app-import';
  await import(pathToFileURL(launch.mainEntry).href);
} catch (error) {
  const diagnostic = describeMacOSLocalAppHostFailure(error, stage, process.argv.length, app.isReady());
  process.stderr.write(`${diagnostic}\n`);
  // LaunchServices may discard inherited stderr. Keep the same bounded
  // diagnostic in the operating system log for installed Host failures.
  spawnSync('/usr/bin/logger', ['-t', 'Nimi Local App Host', diagnostic], { stdio: 'ignore', timeout: 1000 });
  app.exit(78);
}
