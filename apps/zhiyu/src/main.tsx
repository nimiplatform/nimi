import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  NimiRendererHostProvider,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { NimiToaster, NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import './styles.css';
import './renderer/styles.css';
import { zhiyuCanonicalRendererFactory } from './renderer/factory';
import { createZhiyuProductionBindings } from './production/renderer-bindings';
import { AuthGate } from './shell/auth/auth-gate';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import appPackage from '../package.json';
import { ZhiyuNavigationOwner, useZhiyuNavigationOwner } from './shell/app/navigation.js';

installNimiShellRuntimeBridge();

const root = document.getElementById('root');
if (!root) {
  throw new Error('zhiyu root element is missing');
}
root.classList.add('nimi-ui-module--zhiyu');

const overlayRoot = document.createElement('div');
overlayRoot.id = 'zhiyu-production-overlays';
overlayRoot.classList.add('nimi-ui-module--zhiyu');
document.body.append(overlayRoot);

const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'zhiyu-production',
  declaredMethods: [],
  capabilities: [],
  localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
  targets: { renderer: root, overlay: overlayRoot },
  theme: createNimiRendererThemeController({
    scheme: 'light',
    accentPack: 'nimi-accent',
    density: 'regular',
  }),
  operations: {
    invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  overlays: {
    target: overlayRoot,
    acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  surfaceLifecycle: { reportReadyCandidate: () => undefined },
});

function ZhiyuProductionSurface() {
  const [canonical, setCanonical] = useState<ReturnType<
    typeof zhiyuCanonicalRendererFactory.createInstance
  > | null>(null);
  useEffect(() => {
    const instance = zhiyuCanonicalRendererFactory.createInstance(
      createZhiyuProductionBindings(rendererHost.facade),
    );
    setCanonical(instance);
    return () => instance.dispose();
  }, []);
  return canonical?.surfaces.main.render() ?? null;
}

function ZhiyuFrame() {
  const owner = useZhiyuNavigationOwner();
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <NimiAppChrome metadata={{ name: '织羽', version: appPackage.version }} locale="zh" navigation={owner.navigation} navigationEnabled={owner.ready}
      sidebar={owner.ready && owner.hasSidebar ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined} />
    <div className="min-h-0 flex-1 overflow-hidden"><AuthGate><ZhiyuProductionSurface /></AuthGate></div><NimiToaster />
  </div>;
}
createRoot(root).render(<React.StrictMode><NimiRendererHostProvider binding={rendererHost}><NimiThemeProvider accentPack="nimi-accent" defaultScheme="light"><TooltipProvider><ZhiyuNavigationOwner><ZhiyuFrame /></ZhiyuNavigationOwner></TooltipProvider></NimiThemeProvider></NimiRendererHostProvider></React.StrictMode>);
