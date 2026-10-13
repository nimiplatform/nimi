import { useEffect, useState } from 'react';
import { NimiRendererHostProvider, type NimiRendererHostBindingV1, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { NimiThemeProvider, NimiToaster, TooltipProvider } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import appPackage from '../../package.json';
import { labCanonicalRendererFactory } from '../renderer/factory.js';
import { createLabProductionBindings } from '../renderer/production-bindings.js';
import '../renderer/styles.css';
import { AuthGate } from './auth/auth-gate.js';
import { useTranslation } from './i18n/index.js';
import { LabNavigationOwner, LabNavigationScope, useLabNavigationOwner } from './routes/app-navigation.js';

export function App(props: { readonly rendererHost: NimiRendererHostBindingV1<NimiRendererHostMethodMap> }) {
  return <NimiRendererHostProvider binding={props.rendererHost}><NimiThemeProvider accentPack="nimi-accent" defaultScheme="light"><TooltipProvider>
    <LabNavigationOwner><LabFrame rendererHost={props.rendererHost} /></LabNavigationOwner>
  </TooltipProvider></NimiThemeProvider></NimiRendererHostProvider>;
}
function LabFrame(props: { readonly rendererHost: NimiRendererHostBindingV1<NimiRendererHostMethodMap> }) {
  const owner = useLabNavigationOwner();
  const { t, i18n } = useTranslation();
  const [canonical, setCanonical] = useState<{ instance: ReturnType<typeof labCanonicalRendererFactory.createInstance>; viewer: boolean } | null>(null);
  useEffect(() => {
    const bindings = createLabProductionBindings(props.rendererHost.facade);
    const instance = labCanonicalRendererFactory.createInstance(bindings);
    setCanonical({ instance, viewer: bindings.route.get().pathname.startsWith('/world-tour-viewer') });
    return () => { owner.setReady(false); void instance.dispose(); };
  }, [props.rendererHost, owner.setReady]);
  const viewer = canonical?.viewer ?? false;
  const content = <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <NimiAppChrome metadata={{ name: viewer ? 'World Tour' : 'Nimi Lab', version: appPackage.version }} locale={i18n.language.startsWith('zh') ? 'zh' : 'en'}
      navigation={viewer ? undefined : owner.navigation} navigationEnabled={owner.ready}
      sidebar={!viewer && owner.ready ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined}
      commands={viewer ? [] : [{ id: 'lab.open-settings', label: t('Settings.title'), menu: 'file', state: () => ({ visible: true, enabled: owner.ready }), execute: () => { void owner.navigation.push({ id: 'settings' }); } }]} />
    <div className="min-h-0 flex-1 overflow-hidden"><AuthGate>{owner.ready ? canonical?.instance.surfaces.main.render() ?? null : null}</AuthGate></div>
    <NimiToaster />
  </div>;
  return viewer ? content : <LabNavigationScope>{content}</LabNavigationScope>;
}
