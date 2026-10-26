import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.settings-navigation
// Ephemeral presentation requests, not a second selected-page or history store.
const listeners = new WeakMap<HomeNavigation, Set<() => void>>();
export function subscribeSettingsEntry(navigation: HomeNavigation, listener: () => void) {
  let subscribers = listeners.get(navigation);
  if (!subscribers) { subscribers = new Set(); listeners.set(navigation, subscribers); }
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
export async function openHomeSettings(navigation: HomeNavigation, settingsSection = 'appearance') {
  const generation = navigation.getSnapshot().generation;
  const result = await navigation.push({ id: 'settings', settingsSection });
  if (generation === navigation.getSnapshot().generation && (result.status === 'committed' || result.status === 'unchanged')) {
    for (const listener of listeners.get(navigation) ?? []) listener();
  }
  return result;
}
