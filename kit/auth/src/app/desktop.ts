import { createNimiClient, createNimiError } from '@nimiplatform/kit/core/sdk-contract';
import { createNimiLocalAppStandardShellSurface, openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { createNimiAppSession } from '@nimiplatform/kit/core/app-session';

// @nimi-authority: rule.nimi.sdks.feature-clients.r040
export function createDesktopNimiAppSession() {
  const client = createNimiClient({ localApp: { standardShell: createNimiLocalAppStandardShellSurface() } });
  const session = createNimiAppSession({ kind: 'desktop', client, async openAccountOwner() {
    const result = await openDesktopIntent({ intent: { kind: 'open-settings', section: 'profile' } });
    if (result.status !== 'accepted') throw createNimiError({ message: 'Open Nimi Home to manage your account.', reasonCode: result.reasonCode, source: 'sdk' });
  } });
  const focus = () => { void session.recheck(); };
  window.addEventListener('focus', focus);
  return Object.freeze({ ...session, dispose() { window.removeEventListener('focus', focus); session.dispose(); } });
}
