import { createInstalledNimiAppBootstrap } from '@nimiplatform/sdk/app';
import { createInstalledNimiAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

export const testerInstalledAppBootstrap = createInstalledNimiAppBootstrap({
  standardShell: createInstalledNimiAppStandardShellSurface(),
});
