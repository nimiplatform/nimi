export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone', 'workspace-app'];

export function buildDefaultStarterFiles(identity) {
  return [
    {
      path: 'src/main.tsx',
      content: renderDefaultMain(identity),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src/shell/routes/product-area.tsx',
      content: renderDefaultProductArea(identity),
      mutationClass: 'app-owned product code',
    },
    {
      path: 'src/shell/routes/selected-capabilities.tsx',
      content: renderSelectedCapabilities(identity.capabilityResolution),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-tauri/src/main.rs',
      content: renderDefaultTauriMain(),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-electron/main.ts',
      content: renderDefaultElectronMain(identity),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-electron/preload.cts',
      content: DEFAULT_ELECTRON_PRELOAD,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'scripts/bundle-electron-preload.mjs',
      content: DEFAULT_ELECTRON_PRELOAD_BUNDLER,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'tsconfig.electron.json',
      content: DEFAULT_ELECTRON_TSCONFIG,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'vite.config.ts',
      content: DEFAULT_VITE_CONFIG,
      mutationClass: 'scaffold-managed glue',
    },
  ];
}

const DEFAULT_VITE_CONFIG = [
  "import { defineConfig } from 'vite';",
  "import react from '@vitejs/plugin-react';",
  "import tailwindcss from '@tailwindcss/vite';",
  '',
  'export default defineConfig({',
  "  base: './',",
  "  cacheDir: '.vite',",
  '  plugins: [react(), tailwindcss()],',
  '  resolve: {',
  "    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],",
  '  },',
  '});',
  '',
].join('\n');

const DEFAULT_ELECTRON_PRELOAD = [
  "import { contextBridge, ipcRenderer } from 'electron';",
  "import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';",
  '',
  'installNimiElectronRuntimeBridge({ contextBridge, ipcRenderer });',
  '',
].join('\n');

const DEFAULT_ELECTRON_PRELOAD_BUNDLER = [
  "import { build } from 'esbuild';",
  "import path from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  '',
  "const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
  '',
  'await build({',
  "  entryPoints: [path.join(appRoot, 'src-electron/preload.cts')],",
  "  outfile: path.join(appRoot, 'dist-electron/preload.cjs'),",
  '  bundle: true,',
  "  platform: 'node',",
  "  target: 'node22',",
  "  format: 'cjs',",
  "  external: ['electron'],",
  "  logLevel: 'silent',",
  '});',
  '',
].join('\n');

const DEFAULT_ELECTRON_TSCONFIG = `${JSON.stringify({
  extends: './tsconfig.json',
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    skipLibCheck: true,
    noEmit: false,
    outDir: 'dist-electron',
    rootDir: 'src-electron',
    types: ['node', 'electron'],
  },
  include: ['src-electron/**/*.ts', 'src-electron/**/*.cts'],
}, null, 2)}\n`;

function renderDefaultMain(identity) {
  return [
    "import React, { Suspense, lazy } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';",
    "import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';",
    'import {',
    '  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,',
    '  createRendererEntryModuleLoader,',
    "} from '@nimiplatform/kit/shell/renderer/bootstrap';",
    "import './styles.css';",
    "import './shell/auth/auth-i18n.js';",
    '',
    'installNimiShellRuntimeBridge();',
    '',
    'const entryModuleLoader = createRendererEntryModuleLoader({',
    '  retryDelaysMs: DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,',
    '});',
    '',
    'const App = lazy(async () => {',
    `  const mod = await entryModuleLoader.load('entry:${identity.rendererEntryId}', () => import('./shell/App.js'));`,
    '  return { default: mod.App };',
    '});',
    '',
    "createRoot(document.getElementById('root') as HTMLElement).render(",
    '  <React.StrictMode>',
    `    <NimiThemeProvider accentPack="${identity.accentPack}">`,
    '      <TooltipProvider>',
    '        <Suspense fallback={null}>',
    '          <App />',
    '        </Suspense>',
    '      </TooltipProvider>',
    '    </NimiThemeProvider>',
    '  </React.StrictMode>,',
    ');',
    '',
  ].join('\n');
}

function renderDefaultProductArea(identity) {
  return [
    "import { useEffect, useState } from 'react';",
    "import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';",
    "import { DemoSurfaces } from './demo-surfaces.js';",
    "import { SelectedCapabilities } from './selected-capabilities.js';",
    "import { getRuntimePlatformProjection } from '../auth/runtime-platform.js';",
    '',
    'export function NimiStarterSurface() {',
    "  const [hostStatus, setHostStatus] = useState('checking');",
    "  const [authorityStatus, setAuthorityStatus] = useState('');",
    '  useEffect(() => {',
    '    let active = true;',
    '    void getRuntimePlatformProjection().then((projection) => {',
    '      if (!active) return;',
    "      if (projection.status !== 'ready') {",
    '        setHostStatus(projection.reasonCode);',
    '        return;',
    '      }',
    "      setHostStatus(`${projection.mode}:${projection.appHost.state}`);",
    "      setAuthorityStatus('app-private-base-entitlement-ready');",
    '    });',
    '    return () => { active = false; };',
    '  }, []);',
    '',
    '  return (',
    '    <main className="mx-auto grid min-h-screen w-full max-w-6xl content-center gap-4 px-5 py-8">',
    '      <Surface material="glass-regular" tone="panel" className="grid gap-4 p-5">',
    '        <div className="grid gap-2">',
    `          <h1 className="m-0 text-2xl font-semibold tracking-normal text-[var(--nimi-text-primary)]">${escapeJsxText(identity.appTitle)}</h1>`,
    '          <p className="m-0 max-w-2xl text-sm leading-6 text-[var(--nimi-text-secondary)]">',
    '            Runtime account, shell transport, SDK calls, and Kit surfaces share one app session.',
    '          </p>',
    '        </div>',
    '        <div className="flex flex-wrap gap-2">',
    '          <Button type="button" tone="primary" size="sm" data-testid="nimi-app-host-status">{hostStatus}</Button>',
    '          <Button type="button" tone="secondary" size="sm">Kit Surface</Button>',
    '        </div>',
    '        <InlineAlert tone="info" data-testid="nimi-app-host-authority-status">',
    '          <span>{authorityStatus || \'Checking the protected local-app session…\'}</span>',
    '        </InlineAlert>',
    '      </Surface>',
    '      <DemoSurfaces />',
    '      <SelectedCapabilities />',
    '    </main>',
    '  );',
    '}',
    '',
    'export function ProductArea() {',
    '  return <NimiStarterSurface />;',
    '}',
    '',
  ].join('\n');
}

function renderSelectedCapabilities(resolution) {
  const imports = [];
  const surfaces = [];
  for (const capability of resolution.capabilities) {
    const relativeTarget = capability.targetRoot.replace(/^src\//, '../../');
    imports.push(`import { ${capability.componentExport} } from '${relativeTarget}/index.js';`);
    surfaces.push(`      <${capability.componentExport} />`);
  }
  return [
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    'export function SelectedCapabilities() {',
    ...(surfaces.length > 0
      ? ['  return (', '    <section className="grid gap-4" data-testid="selected-capabilities">', ...surfaces, '    </section>', '  );']
      : ['  return null;']),
    '}',
    '',
  ].join('\n');
}

function renderDefaultTauriMain() {
  return [
    'fn main() {',
    '    tauri::Builder::default()',
    '        .setup(|app| {',
    '            use tauri::Manager;',
    '            app.manage(',
    '                nimi_shell_tauri::capabilities::runtime::RuntimeBridgeLocalAppHost::platform_default(),',
    '            );',
    '            Ok(())',
    '        })',
    '        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_local_app_standard_shell_handler![])',
    '        .run(tauri::generate_context!())',
    '        .expect("failed to run Nimi App shell");',
    '}',
    '',
  ].join('\n');
}

function renderDefaultElectronMain(identity) {
  return [
    "import path from 'node:path';",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    "import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents } from 'electron';",
    'import {',
    '  isAllowedElectronRendererUrl,',
    '  registerNimiElectronAppAssetProtocolScheme,',
    '  registerNimiElectronAppBridge,',
    "} from '@nimiplatform/kit/shell/electron/main';",
    '',
    `const APP_ID = '${identity.appId}';`,
    "const currentDir = path.dirname(fileURLToPath(import.meta.url));",
    "const appRoot = path.resolve(currentDir, '..');",
    "const preloadPath = path.join(currentDir, 'preload.cjs');",
    "const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();",
    'const developmentRendererUrl = readDevelopmentRendererUrl();',
    'const rendererUrl = developmentRendererUrl || productionRendererUrl;',
    'const allowedRendererUrls = [rendererUrl];',
    '',
    `app.setName(${JSON.stringify(identity.appTitle)});`,
    'Menu.setApplicationMenu(null);',
    'registerNimiElectronAppAssetProtocolScheme(protocol);',
    '',
    'void app.whenReady().then(async () => {',
    '  registerNimiElectronAppBridge({',
    '    appId: APP_ID,',
    '    allowedRendererUrls,',
    '    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },',
    '    ipcMain,',
    '  });',
    '  await createMainWindow();',
    '  app.on(\'activate\', () => {',
    '    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();',
    '  });',
    '});',
    '',
    "app.on('window-all-closed', () => {",
    "  if (process.platform !== 'darwin') app.quit();",
    '});',
    '',
    'async function createMainWindow(): Promise<void> {',
    '  const window = new BrowserWindow({',
    '    width: 1180,',
    '    height: 780,',
    '    minWidth: 360,',
    '    minHeight: 560,',
    `    title: ${JSON.stringify(identity.appTitle)},`,
    '    autoHideMenuBar: true,',
    '    webPreferences: {',
    '      preload: preloadPath,',
    '      contextIsolation: true,',
    '      nodeIntegration: false,',
    '      sandbox: true,',
    '    },',
    '  });',
    '  window.webContents.setWindowOpenHandler(() => ({ action: \'deny\' }));',
    "  window.webContents.on('will-navigate', (event, url) => {",
    '    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();',
    '  });',
    '  await window.loadURL(rendererUrl);',
    '}',
    '',
    'function readDevelopmentRendererUrl(): string {',
    "  const prefix = '--nimi-dev-renderer-url=';",
    '  const values = process.argv.filter((value) => value.startsWith(prefix));',
    '  if (values.length === 0) return \'\';',
    "  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');",
    '  const selected = values[0];',
    "  if (!selected) throw new Error('Nimi development renderer URL is missing.');",
    '  const raw = selected.slice(prefix.length);',
    '  const parsed = new URL(raw);',
    '  if (',
    "    parsed.protocol !== 'http:'",
    "    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())",
    '    || !parsed.port',
    '    || parsed.username',
    '    || parsed.password',
    "    || (parsed.pathname !== '/' && parsed.pathname !== '')",
    '    || parsed.search',
    '    || parsed.hash',
    '  ) {',
    "    throw new Error('Nimi development renderer URL must be exact loopback.');",
    '  }',
    '  return parsed.origin;',
    '}',
    '',
  ].join('\n');
}

function escapeJsxText(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;');
}
