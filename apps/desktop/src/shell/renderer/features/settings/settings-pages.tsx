import { ProfilePage } from './settings-account-panel.js';
import { AppearancePage } from './settings-appearance-page.js';
import { NotificationsPage } from './settings-preferences-panel.js';
import { DeveloperPage } from './settings-developer-page.js';
import { PrivacyPage } from './settings-privacy-page.js';
import { SecurityPage } from './settings-security-page.js';
import { DataManagementPage } from './settings-data-management-page.js';
import { SupportTroubleshooting } from '../support/support-troubleshooting.js';
import { SupportLogsSection } from '../support/support-logs-section.js';

export {
  ProfilePage,
  AppearancePage,
  PrivacyPage,
  SecurityPage,
  NotificationsPage,
  DeveloperPage,
  DataManagementPage,
};

export function renderSettingsPage(selectedId: string) {
  switch (selectedId) {
    case 'profile': return <ProfilePage />;
    case 'appearance': return <AppearancePage />;
    case 'privacy': return <PrivacyPage />;
    case 'security': return <SecurityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'developer': return <DeveloperPage />;
    case 'data': return <DataManagementPage />;
    case 'troubleshooting': return <SupportTroubleshooting />;
    case 'logs': return <SupportLogsSection />;
    default: return <AppearancePage />;
  }
}
