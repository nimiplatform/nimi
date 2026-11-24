import { NimiAppSessionProvider, NimiAppAccessGate } from '@nimiplatform/kit/auth/app';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import appPackage from '../../package.json';
import { useI18n } from '../i18n.js';
import { AppNavigationProvider, useAppNavigation } from './routes/app-navigation.js';
import { AuthenticatedShell } from './authenticated-shell.js';
import { appTitle } from './auth/app-identity.js';
import { getTargetAppSession } from './workbench-target-adapter.js';

export function App() {
  return (
    <NimiAppSessionProvider session={getTargetAppSession()}>
      <AppNavigationProvider>
        <AppFrame />
      </AppNavigationProvider>
    </NimiAppSessionProvider>
  );
}

function AppFrame() {
  const owner = useAppNavigation();
  const { locale, t } = useI18n();
  return (
    <div className="harness-window">
      <NimiAppChrome
        metadata={{ name: appTitle, version: appPackage.version }}
        locale={locale}
        navigation={owner.navigation}
        navigationEnabled={owner.ready}
        commands={[{
          id: 'app.nimi-account',
          label: t('app.account'),
          menu: 'file',
          state: () => ({ visible: true, enabled: true }),
          execute: async () => {
            const account = getTargetAppSession().account;
            if (account.kind === 'home-managed') await account.openAccountOwner();
          },
        }]}
        sidebar={owner.ready ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined}
      />
      <div className="harness-window-content">
        <NimiAppAccessGate title={appTitle} language={locale}>
          {() => <AuthenticatedShell />}
        </NimiAppAccessGate>
      </div>
      <NimiToaster />
    </div>
  );
}
