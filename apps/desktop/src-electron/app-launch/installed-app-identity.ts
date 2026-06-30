import { NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID } from '@nimiplatform/sdk/runtime';

export const DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID = NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID;
export const DESKTOP_INSTALLED_APP_DEVICE_ID = 'desktop-installed-app-host-device';
export const INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF = NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID;
export const DESKTOP_INSTALLED_APP_CALLER_MODE = 'desktop-launched-nimi-app';

export function desktopInstalledAppInstanceId(appId: string): string {
  const normalized = typeof appId === 'string' ? appId.trim() : '';
  if (!normalized) {
    throw new Error('Desktop installed app instance id requires appId');
  }
  return `${normalized}.desktop-host`;
}
