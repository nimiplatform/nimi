import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const desktopRequire = createRequire(path.join(desktopRoot, 'package.json'));

// Keep Node-based renderer tests on the same singleton modules that Vite
// dedupes for the desktop renderer. Tests compile workspace source directly,
// so linked workspace packages can otherwise resolve their own peer copies.
const singletonSpecifiers = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/server',
  'react-dom/server.browser',
  'react-i18next',
  'scheduler',
  'zustand',
];

const singletonUrls = new Map();
for (const specifier of singletonSpecifiers) {
  try {
    singletonUrls.set(specifier, pathToFileURL(desktopRequire.resolve(specifier)).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`desktop test singleton ${specifier} must resolve from ${desktopRoot}: ${message}`, {
      cause: error,
    });
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const singletonUrl = singletonUrls.get(specifier);
    if (singletonUrl) {
      return {
        shortCircuit: true,
        url: singletonUrl,
      };
    }
    return nextResolve(specifier, context);
  },
});
