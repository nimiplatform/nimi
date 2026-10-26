// @nimi-authority: rule.nimi.desktop.product-surfaces.r023
export const SETTINGS_SECTIONS = ['appearance', 'notifications', 'profile', 'privacy', 'security', 'data', 'developer', 'troubleshooting', 'logs'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export const SETTINGS_LABELS: Record<string, string> = {
  appearance: 'Settings.menuAppearance', notifications: 'Settings.menuNotifications',
  profile: 'Settings.menuProfile', privacy: 'Settings.menuPrivacy', security: 'Settings.menuSecurity',
  data: 'Settings.menuData', developer: 'Settings.menuDeveloper',
  troubleshooting: 'Settings.menuTroubleshooting', logs: 'Settings.menuLogs',
};
