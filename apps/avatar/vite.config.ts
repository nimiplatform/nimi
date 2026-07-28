import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const CUBISM_WEB_SDK_VERSION = '5-r.5';
const CUBISM_WEB_SDK_URL = `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`;
const CUBISM_WEB_SDK_CACHE_ROOT = path.resolve(
  __dirname,
  '.cache',
  'assets',
  'js',
  `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`,
);
const DESKTOP_CUBISM_WEB_SDK_CACHE_ROOT = path.resolve(
  __dirname,
  '..',
  'desktop',
  '.cache',
  'assets',
  'js',
  `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`,
);
const CUBISM_WEB_FRAMEWORK_CACHE_ROOT = path.join(CUBISM_WEB_SDK_CACHE_ROOT, 'Framework', 'src');

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function extractZipArchive(zipPath: string, destinationDir: string): void {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param($ZipPath, $DestinationPath) Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestinationPath -Force }',
        zipPath,
        destinationDir,
      ],
      { stdio: 'ignore' },
    );
    return;
  }
  execFileSync('unzip', ['-o', zipPath, '-d', destinationDir], { stdio: 'ignore' });
}

async function ensureCubismFrameworkCache(): Promise<void> {
  const cacheZipPath = path.join(CUBISM_WEB_SDK_CACHE_ROOT, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
  const desktopCacheZipPath = path.join(DESKTOP_CUBISM_WEB_SDK_CACHE_ROOT, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
  const frameworkIndexPath = path.join(CUBISM_WEB_FRAMEWORK_CACHE_ROOT, 'live2dcubismframework.ts');
  if (await pathExists(frameworkIndexPath)) {
    return;
  }
  await mkdir(CUBISM_WEB_SDK_CACHE_ROOT, { recursive: true });
  if (!await pathExists(cacheZipPath)) {
    if (await pathExists(desktopCacheZipPath)) {
      await copyFile(desktopCacheZipPath, cacheZipPath);
    } else {
      const response = await fetch(CUBISM_WEB_SDK_URL);
      if (!response.ok) {
        throw new Error(`Failed to download Cubism SDK from ${CUBISM_WEB_SDK_URL}: ${response.status} ${response.statusText}`);
      }
      await writeFile(cacheZipPath, Buffer.from(await response.arrayBuffer()));
    }
  }
  extractZipArchive(cacheZipPath, path.dirname(CUBISM_WEB_SDK_CACHE_ROOT));

  const sourceCore = path.join(CUBISM_WEB_SDK_CACHE_ROOT, 'Core', 'live2dcubismcore.min.js');
  const publicCore = path.resolve(__dirname, 'src/shell/renderer/public/assets/js/live2d-cubism-core/Core/live2dcubismcore.min.js');
  if (await pathExists(sourceCore) && await pathExists(publicCore)) {
    const [source, current] = await Promise.all([readFile(sourceCore), readFile(publicCore)]);
    if (!source.equals(current)) {
      await copyFile(sourceCore, publicCore);
    }
  }
}

export default defineConfig(() => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const sdkVNextDist = path.resolve(__dirname, '../../sdks/typescript/dist');

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    base: './',
    envDir: workspaceRoot,
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('nimi-avatar'),
    },
    publicDir: path.resolve(__dirname, 'src/shell/renderer/public'),
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'scheduler',
        'zustand',
        '@nimiplatform/sdk',
      ],
      alias: [
        { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
        { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
        { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
        { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
        { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
        { find: '@tauri-apps/api/core', replacement: path.resolve(__dirname, 'node_modules/@tauri-apps/api/core.js') },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@framework', replacement: CUBISM_WEB_FRAMEWORK_CACHE_ROOT },
        { find: '@live2d', replacement: path.resolve(__dirname, 'src/shell/renderer/live2d') },
        { find: '@nas', replacement: path.resolve(__dirname, 'src/shell/renderer/nas') },
        { find: '@mock', replacement: path.resolve(__dirname, 'src/shell/renderer/mock') },
        { find: '@driver', replacement: path.resolve(__dirname, 'src/shell/renderer/driver') },
        { find: '@nimiplatform/sdk/runtime/generated', replacement: path.join(sdkVNextDist, 'runtime/generated.js') },
        { find: '@nimiplatform/sdk/runtime/wire-types', replacement: path.join(sdkVNextDist, 'runtime/wire-types/index.js') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.join(sdkVNextDist, 'runtime/index.js') },
        { find: '@nimiplatform/sdk/realm/generated', replacement: path.join(sdkVNextDist, 'realm/generated.js') },
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
        { find: '@nimiplatform/kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src/index.ts') },
        { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(__dirname, '../../kit/shell/capabilities/src') },
        { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge/index.ts') },
        { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(__dirname, '../../kit/features/avatar/src') },
        { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      ],
    },
    plugins: [
      {
        name: 'nimi-avatar-cubism-framework-cache',
        async configResolved() {
          await ensureCubismFrameworkCache();
        },
      },
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1427,
      strictPort: true,
      fs: {
        allow: [workspaceRoot, path.resolve(__dirname)],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');

            if (normalizedId.includes('/sdks/typescript/dist/core-generated/')) {
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdks/typescript/dist/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/ui/src/')) {
              return 'vendor-platform';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
