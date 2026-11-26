export type WebColorScheme = 'light' | 'dark';

export function resolvePreferredWebColorScheme(
  matchMediaFn: ((query: string) => { matches: boolean }) | undefined =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : undefined,
): WebColorScheme {
  return matchMediaFn?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyWebColorScheme(
  scheme: WebColorScheme,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
  if (!root) return;
  root.dataset.nimiScheme = scheme;
  root.classList.toggle('dark', scheme === 'dark');
}

export function syncSystemWebColorScheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    applyWebColorScheme(media.matches ? 'dark' : 'light');
  };
  update();
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }
  return () => {};
}
