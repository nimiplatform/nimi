import React from 'react';
import { ZhiyuFrame } from './production/surface.js';
import { createRoot } from 'react-dom/client';
import {
  NimiRendererHostProvider,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import './styles.css';
import './renderer/styles.css';
import { ZhiyuNavigationOwner } from './shell/app/navigation.js';

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

createRoot(root).render(<React.StrictMode><NimiRendererHostProvider binding={rendererHost}><NimiThemeProvider accentPack="nimi-accent" defaultScheme="light"><TooltipProvider><ZhiyuNavigationOwner><ZhiyuFrame host={rendererHost.facade} /></ZhiyuNavigationOwner></TooltipProvider></NimiThemeProvider></NimiRendererHostProvider></React.StrictMode>);
