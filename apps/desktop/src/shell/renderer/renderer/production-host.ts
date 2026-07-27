import {
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostBindingV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { readStorageTextFrom, resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';

import {
  LOCALE_STORAGE_KEY,
  resolveSupportedLocale,
} from '../i18n/desktop-i18n.js';

export type DesktopProductionRendererHost = {
  readonly binding: NimiRendererHostBindingV1<NimiRendererHostMethodMap>;
  dispose(): void;
};

export function createDesktopProductionRendererHost(input: {
  readonly opaqueScopePrefix: string;
  readonly renderer: HTMLElement;
}): DesktopProductionRendererHost {
  const stored = readStorageTextFrom(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY);
  const locale = resolveSupportedLocale(stored.state === 'ready' ? stored.value : '');
  const overlay = document.createElement('div');
  overlay.id = `${input.opaqueScopePrefix}-overlays`;
  overlay.classList.add('nimi-ui-module--desktop');
  document.body.append(overlay);
  const binding = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
    opaqueScopePrefix: input.opaqueScopePrefix,
    declaredMethods: [],
    capabilities: [],
    localization: {
      locale: locale === 'zh' ? 'zh-CN' : 'en-US',
      language: locale,
      direction: 'ltr',
    },
    targets: { renderer: input.renderer, overlay },
    theme: createNimiRendererThemeController({
      scheme: 'light',
      accentPack: 'nimi-accent',
      density: 'compact',
    }),
    operations: {
      invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    },
    overlays: {
      target: overlay,
      acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    },
    surfaceLifecycle: {
      reportReadyCandidate() {},
    },
  });
  let disposed = false;
  return Object.freeze({
    binding,
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.remove();
    },
  });
}
