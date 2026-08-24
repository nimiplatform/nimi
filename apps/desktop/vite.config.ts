import { createLogger, defineConfig, loadEnv, searchForWorkspaceRoot, type Logger } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function loadDesktopBuildEnvFiles(): void {
  if (typeof process.loadEnvFile !== 'function') {
    return;
  }

  const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
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
  const desktopRoot = path.resolve(__dirname);
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const results = new Set<string>([
    workspaceRoot,
    desktopRoot,
  ]);

  return Array.from(results);
}

function desktopPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, 'package.json');
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
  const env = loadEnv(mode, __dirname, '');
  const fsAllowList = resolveFsAllowList(env);
  const sdkVNextDist = path.resolve(__dirname, '../../sdks/typescript/dist');
  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    base: mode === 'production' ? './' : '/',
    customLogger: createAsciiConsoleLogger(),
    envPrefix: ['VITE_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_DESKTOP_VERSION': JSON.stringify(desktopPackageVersion()),
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
      'import.meta.env.NIMI_WEB_URL': JSON.stringify(String(env.NIMI_WEB_URL || process.env.NIMI_WEB_URL || '').trim()),
    },
    publicDir: path.resolve(__dirname, 'src/shell/renderer/public'),
    optimizeDeps: {
      include: [
        'zustand',
        'zustand/traditional',
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
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js'),
        },
        {
          find: 'react-dom',
          replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js'),
        },
        {
          find: 'react',
          replacement: path.resolve(__dirname, 'node_modules/react/index.js'),
        },
        {
          find: 'react-i18next',
          replacement: path.resolve(__dirname, 'node_modules/react-i18next/dist/es/index.js'),
        },
        {
          find: '@runtime',
          replacement: path.resolve(__dirname, 'src/runtime'),
        },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
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
        { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(__dirname, '../../kit/shell/capabilities/src') },
        { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge') },
        { find: '@nimiplatform/kit/shell/renderer/bootstrap', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bootstrap') },
        { find: '@nimiplatform/kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary') },
        { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry') },
        { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(__dirname, '../../kit/features/avatar/src') },
        { find: '@nimiplatform/kit/features/agent-center', replacement: path.resolve(__dirname, '../../kit/features/agent-center/src') },
        { find: '@nimiplatform/kit/features/chat', replacement: path.resolve(__dirname, '../../kit/features/chat/src') },
        { find: '@nimiplatform/kit/features/generation', replacement: path.resolve(__dirname, '../../kit/features/generation/src') },
        { find: '@nimiplatform/kit/features/model-config', replacement: path.resolve(__dirname, '../../kit/features/model-config/src') },
        { find: '@nimiplatform/kit/features/model-picker', replacement: path.resolve(__dirname, '../../kit/features/model-picker/src') },
      ],
    },
    plugins: [
      react(),
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
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      modulePreload: {
        polyfill: false,
        resolveDependencies: () => [],
      },
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
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
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'vendor-misc';
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
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});
