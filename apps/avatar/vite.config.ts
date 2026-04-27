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

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
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
        { find: '@nimiplatform/sdk/runtime/browser', replacement: path.resolve(__dirname, '../../sdk/dist/runtime/browser.js') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdk/dist/runtime/index.js') },
        { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/dist/realm/index.js') },
        { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdk/dist/types/index.js') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/dist/index.js') },
        { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src/index.ts') },
        { find: '@nimiplatform/nimi-kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge/index.ts') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
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
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');

            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/ui/src/')) {
              return 'vendor-platform';
            }
            if (normalizedId.includes('/src/shell/renderer/live2d/')) {
              return 'live2d-app';
            }
            if (normalizedId.includes('/src/shell/renderer/nas/')) {
              return 'nas-runtime';
            }
            if (normalizedId.includes('/src/shell/renderer/mock/')) {
              return 'mock-driver';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (normalizedId.includes('/react-dom/') || normalizedId.includes('/react/') || normalizedId.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/zustand/')) {
              return 'vendor-state';
            }
            if (normalizedId.includes('/@protobuf-ts/')) {
              return 'vendor-protobuf';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
