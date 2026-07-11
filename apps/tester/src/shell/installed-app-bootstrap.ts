import { createInstalledNimiAppBootstrap } from '@nimiplatform/sdk/app';
import { createInstalledNimiAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

export const testerInstalledAppBootstrap = createInstalledNimiAppBootstrap({
  standardShell: createInstalledNimiAppStandardShellSurface(),
});

export const testerInstalledRuntimeArtifactReader = Object.freeze({
  async readArtifactBytes(request: { readonly artifactId: string }) {
    const artifact = await testerInstalledAppBootstrap.artifacts.readRuntimeBytes(request.artifactId);
    return {
      bytes: artifact.bytes,
      mimeType: artifact.mimeType,
      sizeBytes: String(artifact.sizeBytes),
      mimeInferred: artifact.mimeInferred,
    };
  },
});
