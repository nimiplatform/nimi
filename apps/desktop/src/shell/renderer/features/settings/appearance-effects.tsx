import { useEffect } from 'react';
import { useNimiTheme } from '@nimiplatform/kit/ui';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from './settings-device-preferences.js';
import { setDesktopAppReducedMotionPreference } from '../../ui/motion/desktop-motion.js';

const DARK_SCHEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the Appearance settings page's device preferences to the real app:
 * the light/dark theme drives `NimiThemeProvider.setScheme` (`system` resolves
 * through `prefers-color-scheme`), and the reduced-motion toggle feeds the
 * desktop motion hooks. Storage projection errors fail closed to defaults.
 */
export function AppearanceEffects() {
  const commands = useDesktopRendererCommands();
  const { setScheme } = useNimiTheme();

  useEffect(() => {
    let preferences: AppearancePreferences;
    try {
      preferences = commands.settings.loadAppearancePreferences();
    } catch {
      preferences = DEFAULT_APPEARANCE_PREFERENCES;
    }
    const media = globalThis.window?.matchMedia?.(DARK_SCHEME_MEDIA_QUERY);

    const apply = () => {
      const resolvedScheme = preferences.theme === 'system'
        ? (media?.matches ? 'dark' : 'light')
        : preferences.theme;
      setScheme(resolvedScheme);
      setDesktopAppReducedMotionPreference(preferences.reduceMotion);
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
    };
  }, [commands, setScheme]);

  return null;
}
