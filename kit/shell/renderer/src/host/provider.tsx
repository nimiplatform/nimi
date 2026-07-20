import {
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { applyNimiThemeAttributesToTarget } from '@nimiplatform/kit/ui';

import type {
  NimiRendererHostBindingV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
  NimiRendererThemeSnapshotV1,
} from './types.js';

const NimiRendererHostContext = createContext<object | null>(null);

export interface NimiRendererHostProviderProps<
  TMethods extends NimiRendererHostMethodMap,
> {
  readonly binding: NimiRendererHostBindingV1<TMethods>;
  readonly children: ReactNode;
}

export function NimiRendererHostProvider<
  TMethods extends NimiRendererHostMethodMap,
>({ binding, children }: NimiRendererHostProviderProps<TMethods>) {
  const theme = useSyncExternalStore(
    binding.facade.theme.subscribe,
    binding.facade.theme.getSnapshot,
    binding.facade.theme.getSnapshot,
  );

  useLayoutEffect(() => {
    const restoreRendererTheme = applyTheme(binding.targets.renderer, theme);
    const restoreOverlayTheme = applyTheme(binding.targets.overlay, theme);
    const restoreRendererDirection = applyDirection(
      binding.targets.renderer,
      binding.facade.localization.direction,
    );
    const restoreOverlayDirection = applyDirection(
      binding.targets.overlay,
      binding.facade.localization.direction,
    );
    return () => {
      restoreOverlayDirection();
      restoreRendererDirection();
      restoreOverlayTheme();
      restoreRendererTheme();
    };
  }, [binding, theme]);

  return createElement(
    NimiRendererHostContext.Provider,
    { value: binding.facade },
    children,
  );
}

export function useNimiRendererHost<
  TMethods extends NimiRendererHostMethodMap,
>(): NimiRendererHostFacadeV1<TMethods> {
  const value = useContext(NimiRendererHostContext);
  if (!value) {
    throw new Error('NIMI_RENDERER_HOST_PROVIDER_MISSING');
  }
  return value as NimiRendererHostFacadeV1<TMethods>;
}

export function useNimiRendererTheme(): NimiRendererThemeSnapshotV1 {
  const host = useNimiRendererHost<NimiRendererHostMethodMap>();
  return useSyncExternalStore(
    host.theme.subscribe,
    host.theme.getSnapshot,
    host.theme.getSnapshot,
  );
}

function applyTheme(
  target: HTMLElement,
  theme: NimiRendererThemeSnapshotV1,
): () => void {
  return applyNimiThemeAttributesToTarget(target, {
    scheme: theme.scheme,
    accentPack: theme.accentPack,
    density: theme.density,
  });
}

function applyDirection(
  target: HTMLElement,
  direction: 'ltr' | 'rtl',
): () => void {
  const previous = target.getAttribute('dir');
  target.setAttribute('dir', direction);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (previous === null) {
      target.removeAttribute('dir');
    } else {
      target.setAttribute('dir', previous);
    }
  };
}
