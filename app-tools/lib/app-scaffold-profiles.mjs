export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone', 'workspace-app', 'tester-reference'];

export function isTesterReferenceProfile(profile) {
  return profile === 'tester-reference';
}

export function buildDefaultStarterFiles(identity) {
  if (isTesterReferenceProfile(identity.profile)) {
    return [];
  }
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
      path: 'src-tauri/src/main.rs',
      content: renderDefaultTauriMain(),
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
  '  plugins: [react(), tailwindcss()],',
  '  resolve: {',
  "    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],",
  '  },',
  '});',
  '',
].join('\n');

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
    "import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';",
    "import { DemoSurfaces } from './demo-surfaces.js';",
    '',
    'export function NimiStarterSurface() {',
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
    '          <Button type="button" tone="primary" size="sm">Runtime Ready</Button>',
    '          <Button type="button" tone="secondary" size="sm">Kit Surface</Button>',
    '        </div>',
    '        <InlineAlert tone="info">',
    '          <span>Nimi Runtime projection is available after the account session is ready.</span>',
    '        </InlineAlert>',
    '      </Surface>',
    '      <DemoSurfaces />',
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

function renderDefaultTauriMain() {
  return [
    'fn nimi_app_renderer_entry_probe_script() -> Result<String, String> {',
    '    nimi_shell_tauri::capabilities::diagnostics::build_renderer_entry_probe_script(',
    '        &nimi_shell_tauri::capabilities::diagnostics::RendererEntryProbeScriptConfig {',
    '            started_flag: "__NIMI_APP_RENDERER_PROBE_STARTED__".to_string(),',
    '            ping_command: "nimi_app_renderer_probe_ping".to_string(),',
    '            report_command: "nimi_app_renderer_probe_report_write".to_string(),',
    '            context_command: "nimi_app_renderer_probe_context_get".to_string(),',
    '            reset_local_storage_scenario_ids: Vec::new(),',
    '        },',
    '    )',
    '}',
    '',
    'fn main() {',
    '    tauri::Builder::default()',
    '        .on_page_load(|webview, payload| {',
    '            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {',
    '                return;',
    '            }',
    '            if let Ok(script) = nimi_app_renderer_entry_probe_script() {',
    '                let _ = webview.eval(script.as_str());',
    '            }',
    '        })',
    '        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler![])',
    '        .run(tauri::generate_context!())',
    '        .expect("failed to run Nimi App shell");',
    '}',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    #[test]',
    '    fn app_consumes_shared_renderer_entry_probe_from_kit() {',
    '        let script = super::nimi_app_renderer_entry_probe_script().expect("probe script");',
    '',
    '        assert!(script.contains("__NIMI_APP_RENDERER_PROBE_STARTED__"));',
    '        assert!(script.contains("nimi_app_renderer_probe_ping"));',
    '        assert!(script.contains("nimi_app_renderer_probe_report_write"));',
    '        assert!(script.contains("nimi_app_renderer_probe_context_get"));',
    '        assert!(script.contains("import(scriptSrc);"));',
    '    }',
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
