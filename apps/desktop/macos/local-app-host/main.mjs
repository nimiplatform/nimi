import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';

import { resolveMacOSLocalAppHostLaunch } from './contract.mjs';

try {
  const launch = resolveMacOSLocalAppHostLaunch({
    argv: process.argv,
    executable: process.execPath,
    hostProfileDirectory: process.env.NIMI_APP_HOST_PROFILE_DIR,
    uid: process.getuid?.(),
    workingDirectory: process.cwd(),
  });
  await import(pathToFileURL(launch.mainEntry).href);
} catch {
  process.stderr.write('local-app-host-launch-untrusted\n');
  app.exit(78);
}
