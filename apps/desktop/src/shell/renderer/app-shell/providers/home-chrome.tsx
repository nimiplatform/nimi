import { useTranslation } from 'react-i18next';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import desktopPackage from '../../../../../package.json';
import { useAppStore, useHomeDestination, useHomeNavigation } from './app-store.js';
import { shouldHideMainLayoutPrimaryRail } from '../layouts/main-layout-primary-rail.js';
import { useProductUpdate } from '../../features/home/product-update-context.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function HomeChrome() {
  const { i18n } = useTranslation();
  const update = useProductUpdate();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const authenticated = useAppStore(state => state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending');
  const bootstrapReady = useAppStore(state => state.bootstrapReady && !state.bootstrapError && !state.runtimeMaintenance);
  const profileDetailOverlayOpen = useAppStore(state => state.profileDetailOverlayOpen);
  const visible = useAppStore(state => state.primaryRailVisible);
  const onVisibleChange = useAppStore(state => state.setPrimaryRailVisible);
  const railAvailable = authenticated && bootstrapReady && !shouldHideMainLayoutPrimaryRail({ activeTab: destination.id, profileDetailOverlayOpen });
  const locale = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en';
  const docsUrl = locale === 'zh' ? 'https://docs.nimi.ai/zh/' : 'https://docs.nimi.ai/';
  return <NimiAppChrome metadata={{ name: 'Nimi Home', version: desktopPackage.version, license: 'MIT' }} navigation={navigation}
    navigationEnabled={authenticated && bootstrapReady} locale={locale}
    commands={[
      { id: 'home.open-downloads', menu: 'view', label: String(i18n.t('runtimeConfig.downloads.title', { defaultValue: 'Downloads' })), state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady }), execute: async () => { await navigation.push({ id: 'downloads' }); } },
      { id: 'home.open-docs', menu: 'help', label: String(i18n.t('Menu.documentation', { defaultValue: 'Documentation' })), group: 'learn', order: 10, state: () => ({ visible: true, enabled: true }), execute: async () => { await openExternalUrl(docsUrl); } },
      { id: 'home.check-update', menu: 'help', label: String(i18n.t('ProductUpdate.check')), group: 'product', order: 80, state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady && update.checkAvailable, busy: update.busy }), execute: update.check },
    ]}
    sidebar={railAvailable ? { visible, onVisibleChange } : undefined} />;
}
