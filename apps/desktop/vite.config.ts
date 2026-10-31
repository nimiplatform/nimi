import { createLogger, defineConfig, loadEnv, searchForWorkspaceRoot, type Logger, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export function desktopRendererModuleCache(sdkDist: string): Plugin {
  return {
    name: 'desktop-renderer-module-cache',
    configureServer(server) {
      // Canonical SDK builds replace dist atomically. macOS can report only
      // directory events; with HMR disabled Vite also retains unlink/add caches.
      const invalidate = (file: string) => {
        for (const environment of Object.values(server.environments)) {
          environment.moduleGraph.onFileChange(file.replaceAll('\\', '/'));
        }
      };
      const invalidateDirectory = (directory: string) => {
        const prefix = `${directory.replaceAll('\\', '/')}/`;
        for (const environment of Object.values(server.environments)) {
          for (const file of environment.moduleGraph.fileToModulesMap.keys()) {
            if (file.startsWith(prefix)) environment.moduleGraph.onFileChange(file);
          }
        }
      };
      // Watch the stable parent: an atomic publish retires the old dist
      // directory and its watch, but subsequent replacements still need events.
      server.watcher.add(path.dirname(sdkDist));
      // Windows can report the parent rename without expanding child events
      // for the replacement directory. Invalidate the same graph in that case.
      server.watcher.on('raw', (_event, file, details: { watchedPath?: string }) => {
        if (details.watchedPath && path.resolve(details.watchedPath) === path.dirname(sdkDist)
          && file === path.basename(sdkDist)) invalidateDirectory(sdkDist);
      });
      server.watcher.on('unlink', invalidate);
      server.watcher.on('add', invalidate);
      server.watcher.on('unlinkDir', invalidateDirectory);
      server.watcher.on('addDir', invalidateDirectory);
    },
  };
}

function loadDesktopBuildEnvFiles(): void {
  if (typeof process.loadEnvFile !== 'function') {
    return;
  }

  const rootEnvPath = path.resolve(import.meta.dirname, '..', '..', '.env');
  if (!fs.existsSync(rootEnvPath)) {
    return;
  }
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // Keep current process env when optional env file is invalid/unreadable.
  }
}

function resolveFsAllowList(env: Record<string, string>): string[] {
  const desktopRoot = path.resolve(import.meta.dirname);
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const results = new Set<string>([
    workspaceRoot,
    desktopRoot,
  ]);

  return Array.from(results);
}

function desktopPackageVersion(): string {
  const pkgPath = path.resolve(import.meta.dirname, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return String(pkg.version || '').trim() || '0.0.0';
}

function sanitizeConsoleText(input: string): string {
  return input
    .replaceAll('➜', '->')
    .replaceAll('→', '->')
    .replaceAll('←', '<-')
    .replaceAll('×', 'x')
    .replaceAll('—', '-')
    .replaceAll('–', '-')
    .replace(/[^\x09\x0A\x0D\x1B\x20-\x7E]/g, '?');
}

function createAsciiConsoleLogger(): Logger {
  const logger = createLogger();
  return {
    get hasWarned() {
      return logger.hasWarned;
    },
    set hasWarned(value: boolean) {
      logger.hasWarned = value;
    },
    info(message, options) {
      logger.info(sanitizeConsoleText(message), options);
    },
    warn(message, options) {
      logger.warn(sanitizeConsoleText(message), options);
    },
    warnOnce(message, options) {
      logger.warnOnce(sanitizeConsoleText(message), options);
    },
    error(message, options) {
      logger.error(sanitizeConsoleText(message), options);
    },
    clearScreen(type) {
      logger.clearScreen(type);
    },
    hasErrorLogged(error) {
      return logger.hasErrorLogged(error);
    },
  };
}

export default defineConfig(({ mode }) => {
  loadDesktopBuildEnvFiles();
  const env = loadEnv(mode, import.meta.dirname, '');
  const fsAllowList = resolveFsAllowList(env);
  const sdkVNextDist = path.resolve(import.meta.dirname, '../../sdks/typescript/dist');
  return {
    root: path.resolve(import.meta.dirname, 'src/shell/renderer'),
    base: mode === 'production' ? './' : '/',
    customLogger: createAsciiConsoleLogger(),
    envPrefix: ['VITE_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_DESKTOP_VERSION': JSON.stringify(desktopPackageVersion()),
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
      'import.meta.env.NIMI_WEB_URL': JSON.stringify(String(env.NIMI_WEB_URL || process.env.NIMI_WEB_URL || '').trim()),
    },
    publicDir: path.resolve(import.meta.dirname, 'src/shell/renderer/public'),
    optimizeDeps: {
      include: [
        // MediaVideo loads this Kit-owned dependency dynamically.
        '@nimiplatform/kit > hls.js',
        'zustand',
        'zustand/traditional',
        // The overview is opened after Home. With HMR disabled, discovering
        // these only on its first open invalidates in-flight module URLs and
        // leaves the independent renderer blank. Prepare its small graph now.
        'lucide-react/dist/esm/icons/circle-alert.mjs',
        'lucide-react/dist/esm/icons/arrow-up-right.mjs',
        'lucide-react/dist/esm/icons/bell.mjs',
        'lucide-react/dist/esm/icons/bell-off.mjs',
        'lucide-react/dist/esm/icons/circle-check.mjs',
        'lucide-react/dist/esm/icons/chevron-right.mjs',
        'lucide-react/dist/esm/icons/download.mjs',
        'lucide-react/dist/esm/icons/ellipsis.mjs',
        'lucide-react/dist/esm/icons/refresh-cw.mjs',
        'lucide-react/dist/esm/icons/x.mjs',
      ],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-i18next',
        'scheduler',
        'zustand',
      ],
      alias: [
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react-dom/client.js'),
        },
        {
          find: 'react-dom',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react-dom/index.js'),
        },
        {
          find: 'react',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react/index.js'),
        },
        {
          find: 'react-i18next',
          replacement: path.resolve(import.meta.dirname, 'node_modules/react-i18next/dist/es/index.js'),
        },
        {
          find: '@runtime',
          replacement: path.resolve(import.meta.dirname, 'src/runtime'),
        },
        { find: '@renderer', replacement: path.resolve(import.meta.dirname, 'src/shell/renderer') },
        { find: '@nimiplatform/sdk/runtime/generated', replacement: path.join(sdkVNextDist, 'runtime/generated.js') },
        { find: '@nimiplatform/sdk/runtime/wire-types', replacement: path.join(sdkVNextDist, 'runtime/wire-types/index.js') },
        { find: '@nimiplatform/sdk/realm/generated', replacement: path.join(sdkVNextDist, 'realm/generated.js') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.join(sdkVNextDist, 'runtime/index.js') },
        { find: '@nimiplatform/sdk/realm', replacement: path.join(sdkVNextDist, 'realm/index.js') },
        { find: '@nimiplatform/sdk/app', replacement: path.join(sdkVNextDist, 'core/app/index.js') },
        { find: '@nimiplatform/sdk/types', replacement: path.join(sdkVNextDist, 'types/index.js') },
        { find: '@nimiplatform/sdk/contracts', replacement: path.join(sdkVNextDist, 'core/contracts/index.js') },
        { find: '@nimiplatform/sdk/ai', replacement: path.join(sdkVNextDist, 'core/ai/index.js') },
        { find: '@nimiplatform/sdk/agent', replacement: path.join(sdkVNextDist, 'core/agent/index.js') },
        { find: '@nimiplatform/sdk/testing', replacement: path.join(sdkVNextDist, 'core/testing/index.js') },
        { find: '@nimiplatform/sdk/features/conversation', replacement: path.join(sdkVNextDist, 'features/conversation/index.js') },
        { find: '@nimiplatform/sdk/features/knowledge-context', replacement: path.join(sdkVNextDist, 'features/knowledge-context/index.js') },
        { find: '@nimiplatform/sdk/features/memory-context', replacement: path.join(sdkVNextDist, 'features/memory-context/index.js') },
        { find: '@nimiplatform/sdk/features/generation', replacement: path.join(sdkVNextDist, 'features/generation/index.js') },
        { find: '@nimiplatform/sdk/features/evaluation', replacement: path.join(sdkVNextDist, 'features/evaluation/index.js') },
        { find: '@nimiplatform/sdk/features/toolkits', replacement: path.join(sdkVNextDist, 'features/toolkits/index.js') },
        { find: '@nimiplatform/sdk', replacement: path.join(sdkVNextDist, 'index.js') },
        { find: '@nimiplatform/kit/ui', replacement: path.resolve(import.meta.dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/kit/auth', replacement: path.resolve(import.meta.dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/kit/core', replacement: path.resolve(import.meta.dirname, '../../kit/core/src') },
        { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(import.meta.dirname, '../../kit/shell/capabilities/src') },
        { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.resolve(import.meta.dirname, '../../kit/shell/renderer/src/bridge') },
        { find: '@nimiplatform/kit/shell/renderer/bootstrap', replacement: path.resolve(import.meta.dirname, '../../kit/shell/renderer/src/bootstrap') },
        { find: '@nimiplatform/kit/telemetry/error-boundary', replacement: path.resolve(import.meta.dirname, '../../kit/telemetry/src/error-boundary') },
        { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(import.meta.dirname, '../../kit/telemetry/src/telemetry') },
        { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(import.meta.dirname, '../../kit/features/avatar/src') },
        { find: '@nimiplatform/kit/features/agent-center', replacement: path.resolve(import.meta.dirname, '../../kit/features/agent-center/src') },
        { find: '@nimiplatform/kit/features/chat', replacement: path.resolve(import.meta.dirname, '../../kit/features/chat/src') },
        { find: '@nimiplatform/kit/features/media', replacement: path.resolve(import.meta.dirname, '../../kit/features/media/src') },
        { find: '@nimiplatform/kit/features/generation', replacement: path.resolve(import.meta.dirname, '../../kit/features/generation/src') },
        { find: '@nimiplatform/kit/features/model-config', replacement: path.resolve(import.meta.dirname, '../../kit/features/model-config/src') },
        { find: '@nimiplatform/kit/features/model-picker', replacement: path.resolve(import.meta.dirname, '../../kit/features/model-picker/src') },
      ],
    },
    plugins: [
      desktopRendererModuleCache(sdkVNextDist),
      react({ exclude: [/\/node_modules\//, /\/src\/(?:shell\/renderer\/)?main\.tsx$/] }),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      hmr: false,
      fs: {
        allow: fsAllowList,
      },
    },
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist'),
      emptyOutDir: true,
      modulePreload: {
        polyfill: false,
        resolveDependencies: () => [],
      },
      sourcemap: true,
      rolldownOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'src/shell/renderer/index.html'),
          'system-entry': path.resolve(import.meta.dirname, 'src/shell/renderer/system-entry.html'),
        },
        output: {
          strictExecutionOrder: true,
          codeSplitting: {
            // Keep each module in its assigned group instead of pulling the
            // SDK and shared Kit dependencies into the app's runtime bridge.
            includeDependenciesRecursively: false,
            groups: [{
              name(id) {
                const normalizedId = id.split(path.sep).join('/');
                if (normalizedId.includes('/sdks/typescript/dist/core-generated/')) {
                  if (normalizedId.includes('/sdks/typescript/dist/core-generated/google/')) {
                    return 'vendor-sdk-runtime-google';
                  }
                  if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/')) {
                    return 'vendor-sdk-runtime-generated';
                  }
                  return 'vendor-sdk-runtime-generated';
                }
                if (normalizedId.includes('/sdks/typescript/dist/')) {
                  return 'vendor-sdk-client';
                }
                if (normalizedId.includes('/apps/desktop/src/runtime/data-sync/')) {
                  return 'runtime-data-sync';
                }
                if (
                  normalizedId.includes('/apps/desktop/src/runtime/local-runtime/')
                  || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
                  || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
                  || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
                ) {
                  return 'runtime-bridge';
                }
                if (normalizedId.includes('/apps/desktop/src/shell/renderer/locales/en/')) {
                  return 'vendor-shell-locale-en';
                }
                if (normalizedId.includes('/apps/desktop/src/shell/renderer/locales/zh/')) {
                  return 'vendor-shell-locale-zh';
                }

                if (!id.includes('node_modules')) {
                  return undefined;
                }
                if (/\/node_modules\/(react|react-dom|scheduler)\//u.test(normalizedId)) {
                  return 'vendor-react';
                }
                // Keep the isolated overview outside the main shell's other libraries.
                if (normalizedId.includes('/node_modules/lucide-react/')) {
                  return 'vendor-icons';
                }
                if (id.includes('/react-router') || id.includes('/@remix-run/router/')) {
                  return 'vendor-router';
                }
                if (id.includes('/@tanstack/react-query/')) {
                  return 'vendor-query';
                }
                if (id.includes('/i18next/') || id.includes('/react-i18next/')) {
                  return 'vendor-i18n';
                }
                if (id.includes('/@nimiplatform/sdk') || id.includes('/ai/') || id.includes('/@ai-sdk/')) {
                  return 'vendor-ai';
                }
                if (
                  id.includes('/socket.io-client/')
                  || id.includes('/engine.io-client/')
                  || id.includes('/socket.io-parser/')
                  || id.includes('/engine.io-parser/')
                ) {
                  return 'vendor-socket';
                }
                if (id.includes('/ajv/') || id.includes('/zod/') || id.includes('/yaml/')) {
                  return 'vendor-data';
                }
                return 'vendor-misc';
              },
            }],
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});
