import { ProfilePage } from './settings-account-panel.js';
import { LanguageRegionPage } from './settings-language-region-panel.js';
import { AppearancePage } from './settings-appearance-page.js';
import { DownloadsPage } from './settings-downloads-page.js';
import { WalletPage } from './settings-advanced-panel.js';
import { NotificationsPage } from './settings-preferences-panel.js';
import { PerformancePage } from './settings-performance-page.js';
import { PrivacyPage } from './settings-privacy-page.js';
import { SecurityPage } from './settings-security-page.js';
import { DataManagementPage } from './settings-data-management-page.js';

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
  DataManagementPage,
};

export function renderSettingsPage(selectedId: string) {
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
    default: return <ProfilePage />;
  }
}
