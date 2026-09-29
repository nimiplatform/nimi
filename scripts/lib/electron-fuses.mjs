import { flipFuses, FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

// Production Home turns off every way to run arbitrary JavaScript inside its
// signed executable without replacing its app code (plain Node mode,
// NODE_OPTIONS, the Node CLI inspector), and loads only its own app.asar,
// checked against the integrity hash sealed in Info.plist. Runtime trusts Home
// by its signature, so the signed binary must not run anything else.
export const HOME_MACOS_FUSES = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

// Windows development tools use the developer's Node installation. The signed
// Home executable therefore has no Node-mode entry point either.
export const HOME_WINDOWS_FUSES = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
});

/** Flips fuses on an extracted Electron binary or app bundle, before signing. */
export async function flipElectronFuses(electronPath, fuses, { resetAdHocDarwinSignature = false } = {}) {
  await flipFuses(electronPath, { version: FuseVersion.V1, resetAdHocDarwinSignature, ...fuses });
}

/** Fails unless the built candidate's fuse wire has exactly these states. */
export async function requireElectronFuses(electronPath, fuses) {
  const wire = await getCurrentFuseWire(electronPath);
  for (const [option, enabled] of Object.entries(fuses)) {
    const expected = enabled ? FuseState.ENABLE : FuseState.DISABLE;
    if (wire[option] !== expected) {
      throw new Error(`Electron fuse ${FuseV1Options[option]} must be ${enabled ? 'enabled' : 'disabled'} in ${electronPath}`);
    }
  }
}
