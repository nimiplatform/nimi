import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acceptanceBuild = process.argv.includes('--acceptance');
const releaseBuild = process.argv.includes('--release');
if (acceptanceBuild && releaseBuild) {
  throw new Error('Electron acceptance and production release build modes are mutually exclusive');
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
    __NIMI_ELECTRON_ACCEPTANCE_BUILD__: JSON.stringify(acceptanceBuild),
  },
  banner: releaseBuild ? {
    js: "import { createRequire as __nimiCreateRequire } from 'node:module'; const require = __nimiCreateRequire(import.meta.url);",
  } : undefined,
  logLevel: 'silent',
});
