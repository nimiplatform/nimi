import { LanguageRegionPage, ProfilePage } from './settings-account-panel';
import { WalletPage } from './settings-advanced-panel';
import { ModSettingsPage } from './settings-mod-panel';
import { NotificationsPage, PerformancePage } from './settings-preferences-panel';
import { DataManagementPage } from './settings-data-management-page';
import { PrivacyPage } from './settings-privacy-page';
import { SecurityPage } from './settings-security-page';
import { DeveloperPage } from './settings-developer-page';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';

export {
  ProfilePage,
  LanguageRegionPage,
  PrivacyPage,
  SecurityPage,
  DataManagementPage,
  NotificationsPage,
  PerformancePage,
  WalletPage,
  ModSettingsPage,
  DeveloperPage,
};

export function renderSettingsPage(selectedId: string) {
  const flags = getShellFeatureFlags();

  switch (selectedId) {
    case 'profile': return <ProfilePage />;
    case 'language': return <LanguageRegionPage />;
    case 'privacy': return <PrivacyPage />;
    case 'security': return <SecurityPage />;
    case 'data': return <DataManagementPage />;
    case 'notifications': return <NotificationsPage />;
    case 'performance': return <PerformancePage />;
    case 'wallet': return <WalletPage />;
    case 'extensions': return flags.enableSettingsExtensions ? <ModSettingsPage /> : <ProfilePage />;
    case 'developer': return <DeveloperPage />;
    default: return <ProfilePage />;
  }
}
