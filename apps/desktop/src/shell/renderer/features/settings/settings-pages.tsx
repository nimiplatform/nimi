import { ProfilePage } from './settings-account-panel.js';
import { LanguageRegionPage } from './settings-language-region-panel.js';
import { WalletPage } from './settings-advanced-panel.js';
import { ModSettingsPage } from './settings-mod-panel.js';
import { NotificationsPage } from './settings-preferences-panel.js';
import { PrivacyPage } from './settings-privacy-page.js';
import { SecurityPage } from './settings-security-page.js';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';

export {
  ProfilePage,
  LanguageRegionPage,
  PrivacyPage,
  SecurityPage,
  NotificationsPage,
  WalletPage,
  ModSettingsPage,
};

export function renderSettingsPage(selectedId: string) {
  const flags = getShellFeatureFlags();

  switch (selectedId) {
    case 'profile': return <ProfilePage />;
    case 'language': return <LanguageRegionPage />;
    case 'privacy': return <PrivacyPage />;
    case 'security': return <SecurityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'wallet': return <WalletPage />;
    case 'extensions': return flags.enableSettingsExtensions ? <ModSettingsPage /> : <ProfilePage />;
    default: return <ProfilePage />;
  }
}
