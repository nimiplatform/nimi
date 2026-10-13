import { useTranslation } from 'react-i18next';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import desktopPackage from '../../../../../package.json';
import { useAppStore, useHomeDestination, useHomeNavigation } from './app-store.js';
import { shouldHideMainLayoutPrimaryRail } from '../layouts/main-layout-primary-rail.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function HomeChrome() {
  const { i18n } = useTranslation();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const authenticated = useAppStore(state => state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending');
  const bootstrapReady = useAppStore(state => state.bootstrapReady && !state.bootstrapError && !state.runtimeMaintenance);
  const profileDetailOverlayOpen = useAppStore(state => state.profileDetailOverlayOpen);
  const visible = useAppStore(state => state.primaryRailVisible);
  const onVisibleChange = useAppStore(state => state.setPrimaryRailVisible);
  const railAvailable = authenticated && bootstrapReady && !shouldHideMainLayoutPrimaryRail({ activeTab: destination.id, profileDetailOverlayOpen });
  return <NimiAppChrome metadata={{ name: 'Nimi Home', version: desktopPackage.version, license: 'MIT' }} navigation={navigation}
    navigationEnabled={authenticated && bootstrapReady} locale={i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'}
    commands={[
      { id: 'home.open-settings', menu: 'file', label: String(i18n.t('Navigation.settings')), state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady }), execute: async () => { await navigation.push({ id: 'settings' }); } },
      { id: 'home.open-downloads', menu: 'view', label: String(i18n.t('runtimeConfig.downloads.title', { defaultValue: 'Downloads' })), state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady }), execute: async () => { await navigation.push({ id: 'downloads' }); } },
    ]}
    sidebar={railAvailable ? { visible, onVisibleChange } : undefined} />;
}
