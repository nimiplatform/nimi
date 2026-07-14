import { createNimiAppRuntimePlatformClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * The sole Tester entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the app never receives principal, grant, session, or
 * transport authority material.
 */
export const testerLocalAppRuntimePlatform = createNimiAppRuntimePlatformClient({
  standardShell: createNimiLocalAppStandardShellSurface(),
});

export const testerLocalRuntimeArtifactReader = Object.freeze({
  async readArtifactBytes(request: { readonly artifactId: string }) {
    const artifact = await testerLocalAppRuntimePlatform.artifacts.readRuntimeBytes(request.artifactId);
    return {
      bytes: artifact.bytes,
      mimeType: artifact.mimeType,
      sizeBytes: String(artifact.sizeBytes),
      mimeInferred: artifact.mimeInferred,
    };
  },
});
