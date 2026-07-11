import {
  createInstalledNimiAppBootstrap,
  type InstalledNimiAppBootstrap,
} from '@nimiplatform/sdk/app';
import {
  createInstalledNimiAppStandardShellSurface,
} from '@nimiplatform/kit/shell/renderer/bridge';

let installedAppBootstrap: InstalledNimiAppBootstrap | null = null;

export function getInstalledNimiAppBootstrap(): InstalledNimiAppBootstrap {
  installedAppBootstrap ??= createInstalledNimiAppBootstrap({
    standardShell: createInstalledNimiAppStandardShellSurface(),
  });
  return installedAppBootstrap;
}
