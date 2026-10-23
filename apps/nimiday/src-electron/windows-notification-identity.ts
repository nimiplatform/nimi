import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

/** Register the notification sender, not a launcher for this supervised App. */
export async function registerWindowsNotificationIdentity(identity: {
  appUserModelId: string;
  displayName: string;
  iconPath: string;
}): Promise<void> {
  if (process.platform !== 'win32') return;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error('Windows SystemRoot is unavailable.');
  await access(identity.iconPath);

  // app.setName() does not change the executable product name used by
  // Electron's automatic Windows shortcut. Register the explicit AUMID's
  // display assets so shared electron.exe hosts retain their own identity.
  // https://learn.microsoft.com/windows/apps/design/shell/tiles-and-notifications/send-local-toast-other-apps
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${identity.appUserModelId}`;
  const registry = path.join(systemRoot, 'System32', 'reg.exe');
  // Windows defines both display asset values as REG_EXPAND_SZ, not REG_SZ.
  for (const [name, value] of [
    ['DisplayName', identity.displayName],
    ['IconUri', identity.iconPath],
  ] as const) {
    await runFile(registry, ['add', key, '/v', name, '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], {
      windowsHide: true,
      timeout: 10_000,
    });
  }
}
