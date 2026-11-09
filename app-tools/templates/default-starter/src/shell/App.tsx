import { NimiAppSessionProvider, NimiAppAccessGate } from '@nimiplatform/kit/auth/app';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import appPackage from '../../package.json';
import { hasGeneratedViews } from '../scaffold/generated/navigation.js';
import { AppNavigationProvider, useAppNavigation } from './routes/app-navigation.js';
import { AuthenticatedShell } from './authenticated-shell.js';
import { appTitle } from './auth/app-identity.js';
import { getTargetAppSession } from './workbench-target-adapter.js';

export function App() {
  return <NimiAppSessionProvider session={getTargetAppSession()}><AppNavigationProvider><AppFrame /></AppNavigationProvider></NimiAppSessionProvider>;
}
function AppFrame() {
  const owner = useAppNavigation();
  // Optional App-owned presentation choices keep product chrome with its owner.
  const sidebarAvailable = 'sidebarAvailable' in owner ? owner.sidebarAvailable === true : hasGeneratedViews;
  const locale = 'locale' in owner && (owner.locale === 'zh' || owner.locale === 'en')
    ? owner.locale : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <NimiAppChrome metadata={{ name: appTitle, version: appPackage.version, license: 'license' in appPackage && typeof appPackage.license === 'string' ? appPackage.license : undefined }} locale={locale} navigation={owner.navigation} navigationEnabled={owner.ready}
        commands={[{ id: 'app.nimi-account', label: locale === 'zh' ? 'Nimi 账号' : 'Nimi account', menu: 'file', state: () => ({ visible: true, enabled: true }), execute: async () => { const account = getTargetAppSession().account; if (account.kind === 'home-managed') await account.openAccountOwner(); } }]}
        sidebar={sidebarAvailable && owner.ready ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <NimiAppAccessGate title={appTitle} language={locale}>{() => <AuthenticatedShell />}</NimiAppAccessGate>
      </div>
      <NimiToaster />
    </div>
  );
}
