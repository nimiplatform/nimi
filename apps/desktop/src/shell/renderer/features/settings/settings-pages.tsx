import { LanguageRegionPage, ProfilePage } from './panels/account-panel';
import { WalletPage } from './panels/advanced-panel';
import { ModSettingsPage } from './panels/mod-settings-panel';
import { NotificationsPage, PerformancePage } from './panels/preferences-panel';
import { DataManagementPage } from './panels/privacy/data-management-page';
import { PrivacyPage } from './panels/privacy/privacy-page';
import { SecurityPage } from './panels/privacy/security-page';
import { DeveloperPage } from './panels/developer-page';
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
