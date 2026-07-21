import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import {
  NimiRendererHostProvider,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import './styles.css';
import './renderer/styles.css';
import { zhiyuCanonicalRendererFactory } from './renderer/factory';
import { createZhiyuProductionBindings } from './production/renderer-bindings';
import { AuthGate } from './shell/auth/auth-gate';
import { installZhiyuElectronSdkAcceptanceProbe } from './shell/auth/electron-sdk-acceptance';
import { ZhiyuLocalDevelopmentJourney } from './shell/local-development/ZhiyuLocalDevelopmentJourney';

installNimiShellRuntimeBridge();
const localDevelopment = window.__nimiZhiyuLocalDevelopment;
if (!localDevelopment) {
  installZhiyuElectronSdkAcceptanceProbe();
}

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

createRoot(root).render(
  <React.StrictMode>
    <NimiRendererHostProvider binding={rendererHost}>
      {localDevelopment?.agentId ? (
        <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
          <ZhiyuLocalDevelopmentJourney target={{ ...localDevelopment, agentId: localDevelopment.agentId }} />
        </NimiThemeProvider>
      ) : (
        <AuthGate>
          <ZhiyuProductionSurface />
        </AuthGate>
      )}
    </NimiRendererHostProvider>
  </React.StrictMode>,
);
