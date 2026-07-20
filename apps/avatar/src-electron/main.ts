import { app } from 'electron';

// The bundled Avatar Electron renderer is hosted only by the verified Desktop
// process. Keeping this entry as an explicit fail-closed tombstone prevents a
// packaged or developer tool from turning it back into an independent Runtime
// host by passing a path directly to Electron.
const failure = Object.freeze({
  status: 'unavailable',
  reasonCode: 'avatar-standalone-electron-host-forbidden',
  actionHint: 'launch_avatar_through_desktop_supervisor',
  source: 'avatar-electron-main',
});

process.stderr.write(`${JSON.stringify(failure)}\n`);
app.exit(1);
