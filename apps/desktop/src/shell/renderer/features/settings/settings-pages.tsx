import { ProfilePage } from './settings-account-panel';
import { LanguageRegionPage } from './settings-language-region-panel';
import { WalletPage } from './settings-advanced-panel';
import { ModSettingsPage } from './settings-mod-panel';
import { NotificationsPage } from './settings-preferences-panel';
import { PrivacyPage } from './settings-privacy-page';
import { SecurityPage } from './settings-security-page';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';

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
