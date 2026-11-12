// @nimi-authority: rule.nimi.platform.app-ecosystem.scaffold-web-carrier
export const WEB_BASE_TEMPLATE_PATHS = new Set([
  '.gitattributes', 'index.html', 'SECURITY.md',
  'src/shell/auth/app-identity.ts', 'src/shell/authenticated-shell.tsx', 'src/styles.css', 'tsconfig.json',
]);

const managed = (path, content) => ({ path, content, mutationClass: 'scaffold-managed glue' });

export function webDevelopmentInput(identity) {
  const origin = `https://127.0.0.1:${identity.devPort}`;
  return { origin, redirect_uri: origin + '/', client_id: `${identity.appId}.web.dev`,
    realm_environment_id: 'dev', realm_url: 'http://127.0.0.1:3002', official_web_url: 'http://localhost:3000',
    command: 'pnpm run dev:web-renderer' };
}

export function webBuildProfile() {
  return { build_profile_ref: 'web-pnpm', test_command: 'pnpm run test:app', build_command: 'pnpm run build',
    output_path: 'dist', lockfile_path: 'pnpm-lock.yaml', lockfile_policy: 'author-install-generates-lockfile',
    ci_install_command: 'pnpm install --frozen-lockfile', targets: { web: { build_command: 'pnpm run build', payload_path: 'dist', runtime_entry: 'payload/index.html' } },
    profile_role: 'developer-workflow-input' };
}

export function webPackage(pkg) {
  const { main: _main, ...result } = pkg;
  for (const name of ['@electron/packager', '@tauri-apps/cli', 'electron', 'pngjs']) delete result.devDependencies[name];
  result.pnpm = { onlyBuiltDependencies: ['esbuild'] };
  result.scripts = { dev: 'nimi-app dev --platform web', 'dev:web-renderer': 'vite',
    init: 'nimi-app init', sync: 'nimi-app sync', check: 'nimi-app check', test: 'nimi-app test',
    'test:app': 'tsc --noEmit', 'app:build': 'nimi-app build', typecheck: 'tsc --noEmit', build: 'tsc --noEmit && vite build',
    'build:release': 'tsc --noEmit && vite build --mode web-release' };
  return result;
}

export function webDependencyMatrix(matrix) {
  for (const name of ['@electron/packager', '@tauri-apps/cli', 'electron', 'pngjs']) delete matrix.npm[name];
  matrix.cargo = {}; delete matrix.toolchain.rust; delete matrix.toolchain.tauri;
  return matrix;
}

export function buildWebStarterFiles(identity, { productArea, navigation }) {
  return [
    { path: 'NIMI_APP.md', mutationClass: 'app-owned product code', content: '# '+identity.appTitle+'\n\nUse this website to work with the AI capabilities supplied by your primary Nimi Runtime. Sign in on the official Nimi page, keep Nimi Home running on the PC, and confirm this source once in Home. Configure the capabilities needed by the selected App features. Results use the App storage scope; other sources do not automatically share files. Cloud inference follows the Runtime configuration and may incur provider charges.\n' },
    managed('src/main.tsx', WEB_MAIN),
    managed('src/shell/App.tsx', WEB_APP),
    managed('src/shell/auth/local-app-client.ts', WEB_CLIENT),
    managed('src/shell/auth/runtime-platform.ts', WEB_RUNTIME),
    managed('src/shell/web-download.ts', WEB_DOWNLOAD),
    managed('vite.config.ts', WEB_VITE),
    managed('src/shell/routes/product-area.tsx', productArea),
    { ...managed('src/shell/routes/app-navigation.tsx', navigation), mutationClass: 'app-owned product code' },
    { path: 'README.md', mutationClass: 'app-owned product code', content: `# ${identity.appTitle}\n\nBrowser App using the shared Nimi SDK and Kit.\n\nInstall dependencies, run init, then check and dev. Configure the exact HTTPS source and callback in nimi.app.yaml. Set NIMI_WEB_TLS_KEY and NIMI_WEB_TLS_CERT in .env.local to certificate files trusted by your browser. Have this source admitted through the Registry owner and confirm it once in PC Home. These steps do not publish the website.\n\nAI and files travel directly to the user's primary Runtime. The dev server forwards only scoped identity and connection coordination. Production hosting must separately provide those bounded routes. No Relay or native Host is installed in the browser.\n\nThe initial test command typechecks the project; add business tests as the App evolves and run real supported tasks. Build does not certify Runtime use. Web pack and automated publishing are unavailable.\n` },
    { path: 'AGENTS.md', mutationClass: 'app-owned product code', content: '# Web App instructions\n\nUse the shared public SDK and Kit. Keep business state with the App and AI execution with Runtime. This project uses official Runtime-client login and an admitted Web source, never native Host proof or a direct provider fallback. Preserve App-owned product code during sync. Use the declared development, test and build commands. New source admission and first Home confirmation belong to their owners; normal reconnection reuses them. Do not publish or bypass trust prompts as part of development.\n' },
  ];
}

const WEB_VITE = `import { defineConfig, loadEnv, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nimiWebViteConfig } from '@nimiplatform/app-tools/web';
export default defineConfig(({ command, mode }) => mergeConfig({ base: './', plugins: [react(), tailwindcss()],
  server: { watch: { ignored: ['**/.nimi/local/**', '**/.tmp/**'] } },
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
}, nimiWebViteConfig({ root: import.meta.dirname, env: { ...loadEnv(mode, import.meta.dirname, ''), ...process.env }, serve: command === 'serve', release: mode === 'web-release' })));
`;

const WEB_CLIENT = `import type { NimiAppScope } from '@nimiplatform/kit/core/app-session';
let scope: NimiAppScope | null = null;
export function setNimiRemoteAppClient(value: NimiAppScope | null) { scope = value; }
export function getNimiLocalAppClient(): NimiAppScope['client'] {
  if (!scope || scope.signal.aborted) throw new Error('Connect to your primary Runtime before starting work.');
  return scope.client;
}
`;

const WEB_RUNTIME = `import { getNimiLocalAppClient } from './local-app-client.js';
export { appId, appTitle, scaffoldProfile } from './app-identity.js';
export async function getRuntimePlatformProjection() {
  try { getNimiLocalAppClient(); return { status: 'ready' as const, mode: 'remote-app' as const }; }
  catch (error) { return { status: 'unavailable' as const, mode: 'remote-app' as const, message: error instanceof Error ? error.message : String(error) }; }
}
`;

const WEB_APP = `import { NimiToaster } from '@nimiplatform/kit/ui';
import { AppNavigationProvider } from './routes/app-navigation.js';
import { AuthenticatedShell } from './authenticated-shell.js';
export function App() { return <AppNavigationProvider><AuthenticatedShell /><NimiToaster /></AppNavigationProvider>; }
`;

const WEB_MAIN = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { createWebNimiAppSession, type NimiRemoteAppConfig } from '@nimiplatform/kit/auth/app/web';
import { NimiAppSessionProvider, NimiAccountControl, NimiAppAccessGate } from '@nimiplatform/kit/auth/app';
import { setNimiRemoteAppClient } from './shell/auth/local-app-client.js';
import { appTitle } from './shell/auth/app-identity.js';
import { App } from './shell/App.js';
import './styles.css';
declare const __NIMI_APP_WEB_CONFIG__: NimiRemoteAppConfig;
const session = createWebNimiAppSession(__NIMI_APP_WEB_CONFIG__);
const off = session.subscribe(() => { const state = session.getSnapshot(); setNimiRemoteAppClient(state.runtime.status === 'connected' ? state.runtime.scope : null); });
const root = document.getElementById('root')!;
root.classList.add('nimi-workbench-host', 'nimi-ui-module--lab'); document.body.classList.add('nimi-ui-module--lab');
const reactRoot = createRoot(root);
reactRoot.render(<React.StrictMode><NimiThemeProvider accentPack="nimi-accent"><TooltipProvider><NimiAppSessionProvider session={session}>
  <div className="flex h-full min-h-0 flex-col"><header className="flex items-center gap-3 border-b p-3"><strong>{appTitle}</strong><NimiAccountControl hideSignedOut language="en" /></header>
  <NimiAppAccessGate title={appTitle} language="en">{() => <main className="min-h-0 flex-1"><App /></main>}</NimiAppAccessGate></div>
</NimiAppSessionProvider></TooltipProvider></NimiThemeProvider></React.StrictMode>);
void session.start();
if (import.meta.hot) import.meta.hot.dispose(() => { session.dispose(); off(); setNimiRemoteAppClient(null); reactRoot.unmount(); });
`;

const WEB_DOWNLOAD = `import { readNimiAppAssetBlob, openNimiAppAssetMediaUrl } from '@nimiplatform/kit/core/app-asset-media';
import { getNimiLocalAppClient } from './auth/local-app-client.js';
export function requestDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  try { document.body.append(anchor); anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  return { destination: 'browser-download' as const, filename, byteSize: blob.size };
}
export const openAssetMediaUrl = (relativePath: string, signal?: AbortSignal) => openNimiAppAssetMediaUrl(getNimiLocalAppClient().storage.assets, relativePath, signal);
export async function downloadAsset(relativePath: string) {
  return requestDownload(relativePath.split('/').at(-1)!, await readNimiAppAssetBlob(getNimiLocalAppClient().storage.assets, relativePath));
}
`;
