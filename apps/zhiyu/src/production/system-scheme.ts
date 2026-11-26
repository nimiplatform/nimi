import { useEffect, useLayoutEffect, useState } from 'react';
import type { NimiThemeScheme } from '@nimiplatform/kit/ui';
import type { createNimiRendererThemeController } from '@nimiplatform/kit/shell/renderer/host';

type ZhiyuThemeController = Pick<
  ReturnType<typeof createNimiRendererThemeController>,
  'getSnapshot' | 'setSnapshot'
>;

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function resolveSystemScheme(): NimiThemeScheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
  }
  return 'light';
}

export function subscribeSystemScheme(onChange: (scheme: NimiThemeScheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  const sync = () => onChange(media.matches ? 'dark' : 'light');
  sync();
  const handleVisibility = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      sync();
    }
  };
  window.addEventListener('focus', sync);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('focus', sync);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }
  media.addListener(sync);
  return () => {
    media.removeListener(sync);
    window.removeEventListener('focus', sync);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  };
}

export function useSystemScheme(themeController?: ZhiyuThemeController): NimiThemeScheme {
  const [scheme, setScheme] = useState<NimiThemeScheme>(resolveSystemScheme);

  useEffect(() => subscribeSystemScheme(setScheme), []);

  useLayoutEffect(() => {
    if (!themeController) return;
    const current = themeController.getSnapshot();
    if (current.scheme !== scheme) {
      themeController.setSnapshot({
        scheme,
        accentPack: current.accentPack,
        density: current.density,
      });
    }
  }, [themeController, scheme]);

  return scheme;
}
