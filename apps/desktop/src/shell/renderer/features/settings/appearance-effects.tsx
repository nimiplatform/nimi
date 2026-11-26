import { useEffect } from 'react';
import { useNimiTheme } from '@nimiplatform/kit/ui';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  getSystemDarkModeQuery,
  type AppearancePreferences,
} from './settings-device-preferences.js';
import { useSetDesktopAppReducedMotionPreference } from '../../ui/motion/desktop-motion.js';

const THEME_TRANSITION_CLASS = 'nimi-theme-transitioning';
const THEME_TRANSITION_MS = 220;

function prefersReducedMotionMedia(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Applies the Appearance settings page's device preferences to the real app:
 * the light/dark theme drives `NimiThemeProvider.setScheme` (`system` resolves
 * through `prefers-color-scheme`), and the reduced-motion toggle feeds the
 * desktop motion hooks. Storage projection errors fail closed to defaults.
 */
export function AppearanceEffects() {
  const commands = useDesktopRendererCommands();
  const { setScheme } = useNimiTheme();
  const setAppReducedMotion = useSetDesktopAppReducedMotionPreference();

  useEffect(() => {
    let preferences: AppearancePreferences;
    try {
      preferences = commands.settings.loadAppearancePreferences();
    } catch {
      preferences = DEFAULT_APPEARANCE_PREFERENCES;
    }
    const media = getSystemDarkModeQuery();
    let previousScheme: 'light' | 'dark' | null = null;
    let transitionTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTransitionClass = () => {
      if (transitionTimer !== null) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
      }
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
      }
    };

    const apply = () => {
      const resolvedScheme: 'light' | 'dark' = preferences.theme === 'system'
        ? (media?.matches ? 'dark' : 'light')
        : preferences.theme;
      const schemeChanged = previousScheme !== null && previousScheme !== resolvedScheme;
      if (
        schemeChanged
        && !preferences.reduceMotion
        && !prefersReducedMotionMedia()
        && typeof document !== 'undefined'
      ) {
        clearTransitionClass();
        document.documentElement.classList.add(THEME_TRANSITION_CLASS);
        transitionTimer = setTimeout(() => {
          transitionTimer = null;
          document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
        }, THEME_TRANSITION_MS);
      }
      previousScheme = resolvedScheme;
      setScheme(resolvedScheme);
      setAppReducedMotion(preferences.reduceMotion);
    };
    apply();

    const unsubscribe = commands.settings.subscribeAppearancePreferences((next) => {
      preferences = next;
      apply();
    });
    const onMediaChange = () => apply();
    media?.addEventListener?.('change', onMediaChange);
    return () => {
      unsubscribe();
      media?.removeEventListener?.('change', onMediaChange);
      clearTransitionClass();
    };
  }, [commands, setAppReducedMotion, setScheme]);

  return null;
}
