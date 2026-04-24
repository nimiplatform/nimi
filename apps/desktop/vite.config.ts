import { defineConfig, loadEnv, searchForWorkspaceRoot, type PluginOption } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const CUBISM_WEB_SDK_VERSION = '5-r.5';
const CUBISM_WEB_SDK_URL = `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`;
const CUBISM_WEB_CORE_PUBLIC_DIR = path.join('assets', 'js', 'live2d-cubism-core', 'Core');
const CUBISM_WEB_SHADER_PUBLIC_DIR = path.join(
  'assets',
  'js',
  'live2d-cubism-framework-shaders',
  'WebGL',
);
const CUBISM_WEB_SDK_CACHE_ROOT = path.resolve(
  __dirname,
  '.cache',
  'assets',
  'js',
  `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`,
);
const CUBISM_WEB_FRAMEWORK_CACHE_ROOT = path.join(CUBISM_WEB_SDK_CACHE_ROOT, 'Framework', 'src');
const CUBISM_WEB_SHADER_CACHE_ROOT = path.join(CUBISM_WEB_SDK_CACHE_ROOT, 'Framework', 'Shaders', 'WebGL');

function resolveOptionalAbsoluteDir(raw: string | undefined, envName: string): string | null {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return null;
  }
  if (!path.isAbsolute(normalized)) {
    throw new Error(`${envName} must be an absolute path. Received: ${normalized}`);
  }
  const resolved = path.resolve(normalized);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${envName} must point to an existing directory. Received: ${resolved}`);
  }
  return resolved;
}

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
  const runtimeModsDir = resolveOptionalAbsoluteDir(
    env.NIMI_RUNTIME_MODS_DIR || process.env.NIMI_RUNTIME_MODS_DIR,
    'NIMI_RUNTIME_MODS_DIR',
  );
  const results = new Set<string>([
    workspaceRoot,
    desktopRoot,
  ]);
  if (runtimeModsDir) {
    results.add(runtimeModsDir);
  }

  return Array.from(results);
}

function desktopPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return String(pkg.version || '').trim() || '0.0.0';
}

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
      {
        stdio: 'ignore',
      },
    );
    return;
  }

  execFileSync('unzip', ['-o', zipPath, '-d', destinationDir], {
    stdio: 'ignore',
  });
}

async function ensureCubismSdkExtracted(
  cacheZipPath: string,
  cacheRoot: string,
  requiredPaths: string[],
): Promise<void> {
  const missingRequiredPath = await Promise.all(requiredPaths.map((targetPath) => pathExists(targetPath)))
    .then((results) => results.some((exists) => !exists));
  if (!missingRequiredPath) {
    return;
  }

  await mkdir(cacheRoot, { recursive: true });
  extractZipArchive(cacheZipPath, path.dirname(cacheRoot));
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function cubismWebCorePlugin(): PluginOption {
  return {
    name: 'nimi-sync-cubism-web-sdk',
    async configResolved(config) {
      const cacheRoot = CUBISM_WEB_SDK_CACHE_ROOT;
      const cacheZipPath = path.join(cacheRoot, `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`);
      const cacheCorePath = path.join(cacheRoot, 'Core', 'live2dcubismcore.min.js');
      const cacheFrameworkIndexPath = path.join(CUBISM_WEB_FRAMEWORK_CACHE_ROOT, 'live2dcubismframework.ts');
      const cacheShaderIndexPath = path.join(CUBISM_WEB_SHADER_CACHE_ROOT, 'vertshadersrc.vert');
      const publicCoreDir = path.resolve(config.publicDir, CUBISM_WEB_CORE_PUBLIC_DIR);
      const publicCorePath = path.join(publicCoreDir, 'live2dcubismcore.min.js');
      const publicShaderDir = path.resolve(config.publicDir, CUBISM_WEB_SHADER_PUBLIC_DIR);

      await mkdir(cacheRoot, { recursive: true });
      if (!await pathExists(cacheZipPath)) {
        const response = await fetch(CUBISM_WEB_SDK_URL);
        if (!response.ok) {
          throw new Error(`Failed to download Cubism SDK from ${CUBISM_WEB_SDK_URL}: ${response.status} ${response.statusText}`);
        }
        const zipBytes = Buffer.from(await response.arrayBuffer());
        await writeFile(cacheZipPath, zipBytes);
      }
      await ensureCubismSdkExtracted(cacheZipPath, cacheRoot, [
        cacheCorePath,
        cacheFrameworkIndexPath,
        cacheShaderIndexPath,
      ]);

      await mkdir(publicCoreDir, { recursive: true });
      await mkdir(publicShaderDir, { recursive: true });
      const hasPublicCore = await pathExists(publicCorePath);
      const [publicBytes, cacheBytes] = await Promise.all([
        hasPublicCore ? readFile(publicCorePath) : Promise.resolve<Buffer | null>(null),
        readFile(cacheCorePath),
      ]);
      if (publicBytes === null || !publicBytes.equals(cacheBytes)) {
        await copyFile(cacheCorePath, publicCorePath);
      }

      const shaderEntryNames = (await fs.promises.readdir(CUBISM_WEB_SHADER_CACHE_ROOT)).filter(Boolean);
      await Promise.all(shaderEntryNames.map(async (entryName) => {
        const cacheShaderPath = path.join(CUBISM_WEB_SHADER_CACHE_ROOT, entryName);
        const publicShaderPath = path.join(publicShaderDir, entryName);
        const hasPublicShader = await pathExists(publicShaderPath);
        const [publicShaderBytes, cacheShaderBytes] = await Promise.all([
          hasPublicShader ? readFile(publicShaderPath) : Promise.resolve<Buffer | null>(null),
          readFile(cacheShaderPath),
        ]);
        if (publicShaderBytes === null || !publicShaderBytes.equals(cacheShaderBytes)) {
          await copyFile(cacheShaderPath, publicShaderPath);
        }
      }));
    },
  };
}

export default defineConfig(({ mode }) => {
  loadDesktopBuildEnvFiles();
  const env = loadEnv(mode, __dirname, '');
  const fsAllowList = resolveFsAllowList(env);
  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    base: mode === 'production' ? './' : '/',
    envPrefix: ['VITE_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_DESKTOP_VERSION': JSON.stringify(desktopPackageVersion()),
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
    },
    publicDir: path.resolve(__dirname, 'src/shell/renderer/public'),
    optimizeDeps: {
      // Force Vite to prebundle the react-three -> zustand/traditional chain so
      // the browser never evaluates the raw CJS shim entry as native ESM.
      include: [
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
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
          find: '@framework',
          replacement: CUBISM_WEB_FRAMEWORK_CACHE_ROOT,
        },
        {
          find: '@runtime',
          replacement: path.resolve(__dirname, 'src/runtime'),
        },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@nimiplatform/sdk/world', replacement: path.resolve(__dirname, '../../sdk/src/world/index.ts') },
        { find: '@nimiplatform/sdk/runtime/browser', replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts') },
        { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/src/realm/index.ts') },
        { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdk/src/types/index.ts') },
        { find: '@nimiplatform/sdk/ai-provider', replacement: path.resolve(__dirname, '../../sdk/src/ai-provider/index.ts') },
        { find: '@nimiplatform/sdk/scope', replacement: path.resolve(__dirname, '../../sdk/src/scope/index.ts') },
        { find: '@nimiplatform/sdk/mod/lifecycle', replacement: path.resolve(__dirname, '../../sdk/src/mod/lifecycle.ts') },
        { find: '@nimiplatform/sdk/mod/shell', replacement: path.resolve(__dirname, '../../sdk/src/mod/shell.ts') },
        { find: '@nimiplatform/sdk/mod/storage', replacement: path.resolve(__dirname, '../../sdk/src/mod/storage/index.ts') },
        { find: '@nimiplatform/sdk/mod', replacement: path.resolve(__dirname, '../../sdk/src/mod/browser.ts') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src/index.ts') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/nimi-kit/features/chat', replacement: path.resolve(__dirname, '../../kit/features/chat/src') },
        { find: '@nimiplatform/nimi-kit/features/model-picker', replacement: path.resolve(__dirname, '../../kit/features/model-picker/src') },
        { find: '@nimiplatform/nimi-kit/features/generation', replacement: path.resolve(__dirname, '../../kit/features/generation/src') },
      ],
    },
    plugins: [
      cubismWebCorePlugin(),
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      fs: {
        allow: fsAllowList,
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      modulePreload: {
        resolveDependencies: (_filename, deps) => deps.filter((dep) => !dep.includes('vendor-three-core')),
      },
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');
            if (normalizedId.includes('/apps/desktop/src/shell/renderer/features/chat/')) {
              if (
                normalizedId.includes('/chat-agent-runtime')
                || normalizedId.includes('/chat-agent-orchestration')
                || normalizedId.includes('/chat-agent-continuity')
                || normalizedId.includes('/chat-agent-turn-plan')
                || normalizedId.includes('/chat-agent-voice-workflow')
                || normalizedId.includes('/chat-agent-voice-workflow-tracker')
                || normalizedId.includes('/chat-agent-voice-capture')
                || normalizedId.includes('/chat-agent-user-projection')
              ) {
                return 'chat-agent-engine';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-avatar-',
                '/chat-right-panel-character-rail',
                '/chat-agent-anchored-avatar-stage',
              ])) {
                return 'chat-agent-avatar';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-diagnostics',
                '/chat-agent-debug-metadata',
              ])) {
                return 'chat-agent-diagnostics';
              }
              if (matchesAny(normalizedId, [
                '/chat-shared-runtime-stream-ui',
                '/chat-stream-',
              ])) {
                return 'chat-stream-ui';
              }
              if (matchesAny(normalizedId, [
                '/chat-human-canonical-composer-profile',
              ])) {
                return 'chat-composer-profile';
              }
              if (matchesAny(normalizedId, [
                '/chat-group-composer',
              ])) {
                return 'chat-group-composer';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-canonical-composer',
                '/chat-composer-',
              ])) {
                return 'chat-composer-ui';
              }
              if (normalizedId.includes('/chat-human-canonical-components')) {
                return 'chat-human-ui';
              }
              if (normalizedId.includes('/chat-human-')) {
                return 'chat-human-core';
              }
              if (
                normalizedId.includes('/conversation-capability')
                || normalizedId.includes('/conversation-submit-readiness')
                || normalizedId.includes('/capability-settings-shared')
                || normalizedId.includes('/chat-shared-thinking')
                || normalizedId.includes('/chat-shared-execution-scheduling-guard')
              ) {
                return 'chat-capabilities';
              }
              if (matchesAny(normalizedId, [
                '/chat-settings-',
                '/chat-shared-settings-panel',
              ])) {
                return 'chat-settings-ui';
              }
              if (normalizedId.includes('/chat-nimi-')) {
                return 'chat-nimi-core';
              }
              if (normalizedId.includes('/chat-agent-')) {
                return 'chat-agent-shell';
              }
            }
            if (normalizedId.includes('/apps/desktop/src/shell/renderer/features/runtime-config/')) {
              if (matchesAny(normalizedId, [
                '/runtime-config-page-overview',
                '/runtime-config-usage-stats-section',
                '/runtime-config-global-audit-',
              ])) {
                return 'runtime-config-overview';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-cloud',
                '/runtime-config-provider-',
                '/runtime-config-pricing-',
                '/runtime-config-cost-estimator',
                '/runtime-config-external-agent-access',
              ])) {
                return 'runtime-config-cloud';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-local',
                '/runtime-config-local-',
                '/runtime-config-memory-embedding-',
              ])) {
                return 'runtime-config-local';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-runtime',
                '/runtime-daemon-',
                '/runtime-health-',
                '/runtime-config-runtime-',
              ])) {
                return 'runtime-config-runtime';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-knowledge',
                '/runtime-config-page-knowledge-',
                '/runtime-config-knowledge-',
              ])) {
                return 'runtime-config-knowledge';
              }
              if (normalizedId.includes('/runtime-config-page-mods')) {
                return 'runtime-config-mods';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-catalog',
                '/runtime-config-catalog-',
              ])) {
                return 'runtime-config-catalog';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-profiles',
                '/runtime-config-profile-',
              ])) {
                return 'runtime-config-profiles';
              }
              if (matchesAny(normalizedId, [
                '/runtime-config-page-recommend',
                '/runtime-config-page-recommend-',
              ])) {
                return 'runtime-config-recommend';
              }
            }
            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              return 'vendor-sdk-runtime-generated';
            }
            if (normalizedId.includes(CUBISM_WEB_FRAMEWORK_CACHE_ROOT.split(path.sep).join('/'))) {
              return 'vendor-live2d';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/data-sync/')) {
              return 'runtime-data-sync';
            }
            if (
              normalizedId.includes('/apps/desktop/src/runtime/local-runtime/')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/local-ai')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/external-agent')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
            ) {
              return 'runtime-bridge';
            }
            if (normalizedId.endsWith('/apps/desktop/src/shell/renderer/locales/en.json')) {
              return 'vendor-shell-locale-en';
            }
            if (normalizedId.endsWith('/apps/desktop/src/shell/renderer/locales/zh.json')) {
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
            if (id.includes('/three/') || id.includes('/simplex-noise/')) {
              return 'vendor-three-core';
            }
            if (
              id.includes('/@react-three/')
              || id.includes('/postprocessing/')
              || id.includes('/three-stdlib/')
              || id.includes('/troika-three-text/')
              || id.includes('/troika-three-utils/')
              || id.includes('/maath/')
              || id.includes('/@monogrid/gainmap-js/')
            ) {
              return 'vendor-three-react';
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
