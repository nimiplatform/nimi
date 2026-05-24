import { ProfilePage } from './settings-account-panel.js';
import { LanguageRegionPage } from './settings-language-region-panel.js';
import { AppearancePage } from './settings-appearance-page.js';
import { DownloadsPage } from './settings-downloads-page.js';
import { WalletPage } from './settings-advanced-panel.js';
import { ModSettingsPage } from './settings-mod-panel.js';
import { NotificationsPage } from './settings-preferences-panel.js';
import { PerformancePage } from './settings-performance-page.js';
import { PrivacyPage } from './settings-privacy-page.js';
import { SecurityPage } from './settings-security-page.js';
import { DataManagementPage } from './settings-data-management-page.js';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';

export {
  ProfilePage,
  LanguageRegionPage,
  AppearancePage,
  DownloadsPage,
  PrivacyPage,
  SecurityPage,
  NotificationsPage,
  PerformancePage,
  WalletPage,
  ModSettingsPage,
  DataManagementPage,
};

export function renderSettingsPage(selectedId: string) {
  const flags = getShellFeatureFlags();

  switch (selectedId) {
    case 'profile': return <ProfilePage />;
    case 'language': return <LanguageRegionPage />;
    case 'appearance': return <AppearancePage />;
    case 'privacy': return <PrivacyPage />;
    case 'security': return <SecurityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'downloads': return <DownloadsPage />;
    case 'performance': return <PerformancePage />;
    case 'data': return <DataManagementPage />;
    case 'wallet': return <WalletPage />;
    case 'extensions': return flags.enableSettingsExtensions ? <ModSettingsPage /> : <ProfilePage />;
    default: return <ProfilePage />;
  }
}
