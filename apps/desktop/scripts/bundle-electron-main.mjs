import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from './generated/macos-local-development-profile.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseBuild = process.argv.includes('--release');
const macOSLocalDevelopmentBuild = process.argv.includes('--macos-local-development');
const supportedArguments = new Set(['--release', '--macos-local-development']);
const unknownArgument = process.argv.slice(2).find((value) => !supportedArguments.has(value));
if (unknownArgument) throw new Error(`unsupported Electron main build argument: ${unknownArgument}`);
if (macOSLocalDevelopmentBuild && !releaseBuild) {
  throw new Error('macOS local-development Electron main requires the release packaging surface');
}

await build({
  entryPoints: [path.join(appRoot, 'src-electron/main.ts')],
  outfile: path.join(appRoot, 'dist-electron/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: releaseBuild
    ? ['electron', 'sharp', '@nimiplatform/kit-protected-local-darwin-arm64']
    : ['electron', '@nimiplatform/*', 'yaml'],
  define: {
    __NIMI_ELECTRON_DEVELOPMENT_BUILD__: JSON.stringify(!releaseBuild),
    __NIMI_MACOS_LOCAL_APP_HOST_PATH__: JSON.stringify(
      macOSLocalDevelopmentBuild ? MACOS_LOCAL_DEVELOPMENT_PROFILE.localAppHostPath : '',
    ),
    __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: JSON.stringify(macOSLocalDevelopmentBuild),
  },
  banner: releaseBuild ? {
    js: "import { createRequire as __nimiCreateRequire } from 'node:module'; const require = __nimiCreateRequire(import.meta.url);",
  } : undefined,
  logLevel: 'silent',
});
