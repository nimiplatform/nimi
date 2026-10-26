import { useState, useSyncExternalStore } from 'react';
import { homeShellPresence } from './home-shell-presence.js';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { LegalDocumentView } from '../../features/legal/legal-document-view.js';
import { openHomeSettings } from '../../features/settings/settings-entry.js';
import { useTranslation } from 'react-i18next';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import desktopPackage from '../../../../../package.json';
import { useAppStore, useHomeDestination, useHomeNavigation } from './app-store.js';
import { shouldHideMainLayoutPrimaryRail } from '../layouts/main-layout-primary-rail.js';
import { useProductUpdate } from '../../features/home/product-update-context.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function HomeChrome() {
  const { i18n, t } = useTranslation();
  const [legal, setLegal] = useState<'terms' | 'privacy' | null>(null);
  const update = useProductUpdate();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const presence = homeShellPresence(navigation);
  const ordinaryHomeMounted = useSyncExternalStore(presence.subscribe, presence.getSnapshot, presence.getSnapshot);
  const authenticated = useAppStore(state => state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending');
  const bootstrapReady = useAppStore(state => state.bootstrapReady && !state.bootstrapError && !state.runtimeMaintenance);
  const profileDetailOverlayOpen = useAppStore(state => state.profileDetailOverlayOpen);
  const visible = useAppStore(state => state.primaryRailVisible);
  const onVisibleChange = useAppStore(state => state.setPrimaryRailVisible);
  const railAvailable = authenticated && bootstrapReady && !shouldHideMainLayoutPrimaryRail({ activeTab: destination.id, profileDetailOverlayOpen });
  const locale = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en';
  const docsUrl = locale === 'zh' ? 'https://docs.nimi.ai/zh/' : 'https://docs.nimi.ai/';
  return <><NimiAppChrome metadata={{ name: 'Nimi Home', version: desktopPackage.version, license: 'MIT' }} navigation={navigation}
    navigationEnabled={authenticated && bootstrapReady} locale={locale}
    commands={[
      { id: 'home.open-settings', menu: 'file', label: t('Menu.settings'), shortcut: 'Ctrl+,', group: 'preferences', order: 5, state: () => ({ visible: true, enabled: ordinaryHomeMounted && authenticated && bootstrapReady }), execute: async () => { await openHomeSettings(navigation); } },
      { id: 'home.open-troubleshooting', menu: 'help', label: t('Settings.menuTroubleshooting'), group: 'support', order: 30, state: () => ({ visible: ordinaryHomeMounted && authenticated && bootstrapReady, enabled: ordinaryHomeMounted && authenticated && bootstrapReady }), execute: async () => { await openHomeSettings(navigation, 'troubleshooting'); } },
      { id: 'home.open-logs', menu: 'help', label: t('Settings.menuLogs'), group: 'support', order: 31, state: () => ({ visible: ordinaryHomeMounted && authenticated && bootstrapReady, enabled: ordinaryHomeMounted && authenticated && bootstrapReady }), execute: async () => { await openHomeSettings(navigation, 'logs'); } },
      { id: 'home.open-terms', menu: 'help', label: t('Legal.terms.title'), group: 'legal', order: 92, state: () => ({ visible: true, enabled: true }), execute: () => setLegal('terms') },
      { id: 'home.open-privacy', menu: 'help', label: t('Legal.privacy.title'), group: 'legal', order: 93, state: () => ({ visible: true, enabled: true }), execute: () => setLegal('privacy') },
      { id: 'home.open-downloads', menu: 'view', label: String(i18n.t('runtimeConfig.downloads.title', { defaultValue: 'Downloads' })), state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady }), execute: async () => { await navigation.push({ id: 'downloads' }); } },
      { id: 'home.open-docs', menu: 'help', label: String(i18n.t('Menu.documentation', { defaultValue: 'Documentation' })), group: 'learn', order: 10, state: () => ({ visible: true, enabled: true }), execute: async () => { await openExternalUrl(docsUrl); } },
      { id: 'home.check-update', menu: 'help', label: String(i18n.t('ProductUpdate.check')), group: 'product', order: 80, state: () => ({ visible: authenticated, enabled: authenticated && bootstrapReady && update.checkAvailable, busy: update.busy }), execute: update.check },
    ]}
    sidebar={railAvailable ? { visible, onVisibleChange } : undefined} />
    <OverlayShell open={legal !== null} kind="dialog" size="lg" title={legal ? t(`Legal.${legal}.title`) : ''} onClose={() => setLegal(null)}
      dataTestId="home-legal-reader" panelClassName="flex max-h-[88vh] flex-col" contentClassName="flex min-h-0 flex-1 flex-col p-0"
      footer={<Button onClick={() => setLegal(null)}>{t('Common.close')}</Button>}>
      {legal ? <LegalDocumentView documentKey={legal} hideTitle /> : null}
    </OverlayShell>
  </>;
}
