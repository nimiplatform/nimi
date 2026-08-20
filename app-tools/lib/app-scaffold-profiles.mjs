export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone'];

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
    ...buildGeneratedModuleCompositionFiles(identity),
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
    "const rendererRoot = document.getElementById('root') as HTMLElement;",
    "rendererRoot.classList.add('nimi-workbench-host');",
    'createRoot(rendererRoot).render(',
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

function renderDefaultProductArea(_identity) {
  return [
    "import { WorkbenchCore, WorkbenchEmptyState } from '../../workbench-core/index.js';",
    "import { appTitle } from '../auth/app-identity.js';",
    "import { GeneratedModuleHost, GeneratedRouteRegistry } from '../../scaffold/generated/route-registry.js';",
    'import {',
    '  generatedInitialViewId,',
    '  generatedNavigationGroups,',
    '  hasGeneratedViews,',
    '  isGeneratedViewId,',
    "} from '../../scaffold/generated/navigation.js';",
    "import { useCallback, useState } from 'react';",
    '',
    "const VIEW_STORAGE_KEY = 'nimi.app.workbench-view.v1';",
    '',
    'function readInitialViewId(): string | null {',
    '  try {',
    '    const stored = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY);',
    '    return stored && isGeneratedViewId(stored) ? stored : generatedInitialViewId;',
    '  } catch {',
    '    return generatedInitialViewId;',
    '  }',
    '}',
    '',
    'export function ProductArea() {',
    '  const [activeViewId, setActiveViewId] = useState<string | null>(readInitialViewId);',
    '  const selectView = useCallback((viewId: string) => {',
    '    if (!isGeneratedViewId(viewId)) return;',
    '    setActiveViewId(viewId);',
    '    try { globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, viewId); } catch { /* UI state remains session-local. */ }',
    '  }, []);',
    '  return (',
    '    <GeneratedModuleHost onSelectView={selectView}>',
    '      <WorkbenchCore<string>',
    '      activeViewId={activeViewId}',
    '      navigationLabel="App modules"',
    '      navigationGroups={generatedNavigationGroups}',
    '      onSelectView={selectView}',
    '      rootTestId="nimi-app-workbench"',
    '    >',
    '        {hasGeneratedViews && activeViewId ? (',
    '          <GeneratedRouteRegistry activeViewId={activeViewId} onSelectView={selectView} />',
    '        ) : (',
    '          <WorkbenchEmptyState',
    '            appTitle={appTitle}',
    '            eyebrow="Nimi App"',
    '            title="Ready for product modules"',
    '            description="This identity-neutral workbench is ready. Add a coarse product module when the App needs one."',
    '            status="Runtime ready"',
    '          />',
    '        )}',
    '      </WorkbenchCore>',
    '    </GeneratedModuleHost>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function buildGeneratedModuleCompositionFiles(identity) {
  const resolution = identity.capabilityResolution;
  const files = [
    generatedFile('capability-registry.ts', renderGeneratedCapabilityRegistry(resolution)),
    generatedFile('runtime-registry.ts', renderGeneratedRuntimeRegistry(resolution)),
    generatedFile('navigation.ts', renderGeneratedNavigation(resolution)),
    generatedFile('route-registry.tsx', renderGeneratedRouteRegistry(resolution)),
    generatedFile('module-styles.css', renderGeneratedModuleStyles(resolution)),
  ];
  if (hasAIStudioResolution(resolution)) {
    files.push(generatedFile('i18n.ts', renderGeneratedAIStudioI18n()));
    files.push(generatedFile('host-adapters.tsx', renderGeneratedAIStudioHostAdapter(resolution)));
  }
  return files;
}

function generatedFile(filename, content) {
  return {
    path: `src/scaffold/generated/${filename}`,
    content,
    mutationClass: 'scaffold-managed glue',
  };
}

function aiStudioFeatureModules(resolution) {
  return resolution.modules.filter((module) => (
    module.kind === 'feature' && module.productEntry.kind === 'ai-studio-module'
  ));
}

function componentFeatureModules(resolution) {
  return resolution.modules.filter((module) => (
    module.kind === 'feature' && module.productEntry.kind === 'component'
  ));
}

function hasAIStudioResolution(resolution) {
  return aiStudioFeatureModules(resolution).length > 0;
}

function generatedModuleImportPath(module) {
  const modulePath = module.productEntry.modulePath;
  const mapping = module.sourceMappings.find((candidate) => (
    modulePath === candidate.sourceRoot || modulePath.startsWith(`${candidate.sourceRoot}/`)
  ));
  if (!mapping) throw new Error(`Generated module entry is outside its source mappings: ${module.id}`);
  const suffix = modulePath.slice(mapping.sourceRoot.length).replace(/^\//u, '');
  const target = `${mapping.targetRoot}${suffix ? `/${suffix}` : ''}`
    .replace(/^src\//u, '')
    .replace(/\.(?:tsx?|jsx?)$/u, '.js');
  return `../../${target}`;
}

function resolvedAIStudioCore(resolution) {
  const core = resolution.modules.find((module) => module.id === 'ai-studio-core');
  if (!core || core.productEntry.kind !== 'ai-studio-core') {
    throw new Error('Generated AI Studio composition requires the internal AI core');
  }
  return core;
}

function renderGeneratedCapabilityRegistry(resolution) {
  const modules = aiStudioFeatureModules(resolution);
  if (modules.length === 0) {
    return [
      'export const generatedAIStudioModules = Object.freeze([]);',
      'export const generatedAIStudioRegistrations = Object.freeze([]);',
      'export const generatedAIStudioMessageBundles = Object.freeze({ en: Object.freeze({}), zh: Object.freeze({}) });',
      '',
    ].join('\n');
  }
  const core = resolvedAIStudioCore(resolution);
  const imports = [
    'import {',
    `  ${core.productEntry.messageExport},`,
    '  composeAIStudioModules,',
    '  mergeAIStudioMessageBundles,',
    `} from '${generatedModuleImportPath(core)}';`,
  ];
  for (const module of modules) {
    imports.push(
      `import { ${module.productEntry.registrationExport}, ${module.productEntry.messageExport} } from '${generatedModuleImportPath(module)}';`,
    );
  }
  const registrations = modules.map((module) => module.productEntry.registrationExport);
  const messageBundles = modules.map((module) => module.productEntry.messageExport);
  return [
    ...imports,
    '',
    `export const generatedAIStudioModules = Object.freeze([${registrations.join(', ')}]);`,
    'export const generatedAIStudioComposition = composeAIStudioModules(generatedAIStudioModules);',
    'export const generatedAIStudioRegistrations = generatedAIStudioComposition.capabilities;',
    'export const generatedAIStudioMessageBundles = Object.freeze({',
    `  en: mergeAIStudioMessageBundles([${core.productEntry.messageExport}.en, ${messageBundles.map((name) => `${name}.en`).join(', ')}]),`,
    `  zh: mergeAIStudioMessageBundles([${core.productEntry.messageExport}.zh, ${messageBundles.map((name) => `${name}.zh`).join(', ')}]),`,
    '});',
    '',
  ].join('\n');
}

function renderGeneratedRuntimeRegistry(resolution) {
  const modules = aiStudioFeatureModules(resolution);
  if (modules.length === 0) {
    return ['export const generatedStudioRuntimeHandlers = Object.freeze({});', ''].join('\n');
  }
  const imports = [
    `import { composeStudioCapabilityRuntimeHandlers } from '${generatedModuleImportPath(resolvedAIStudioCore(resolution))}';`,
  ];
  for (const module of modules) {
    imports.push(
      `import { ${module.productEntry.runtimeExport} } from '${generatedModuleImportPath(module)}';`,
    );
  }
  return [
    ...imports,
    '',
    'export const generatedStudioRuntimeHandlers = composeStudioCapabilityRuntimeHandlers([',
    ...modules.map((module) => `  ${module.productEntry.runtimeExport},`),
    ']);',
    '',
  ].join('\n');
}

function renderGeneratedNavigation(resolution) {
  const aiModules = aiStudioFeatureModules(resolution);
  const componentModules = componentFeatureModules(resolution);
  const imports = [
    "import type { WorkbenchNavigationGroup } from '../../workbench-core/index.js';",
  ];
  if (aiModules.length > 0) {
    imports.push(
      "import { generatedAIStudioModules } from './capability-registry.js';",
      "import { translateGeneratedMessage } from './i18n.js';",
    );
  }
  if (componentModules.length > 0) {
    imports.push("import { Boxes } from 'lucide-react';");
  }
  const groups = [];
  if (aiModules.length > 0) {
    groups.push(
      '  ...generatedAIStudioModules.map((module) => ({',
      '    id: module.id,',
      '    items: module.capabilities.map((registration) => ({',
      '      id: registration.descriptor.id,',
      '      label: translateGeneratedMessage(registration.descriptor.labelKey),',
      '      icon: registration.icon,',
      '    })),',
      '  })),',
    );
  }
  for (const module of componentModules) {
    groups.push(
      `  { id: ${JSON.stringify(module.id)}, items: [{ id: ${JSON.stringify(module.views[0])}, label: ${JSON.stringify(module.label)}, icon: Boxes }] },`,
    );
  }
  return [
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    'export const generatedNavigationGroups: readonly WorkbenchNavigationGroup<string>[] = Object.freeze([',
    ...groups,
    ']);',
    'export const generatedInitialViewId = generatedNavigationGroups[0]?.items[0]?.id ?? null;',
    'export const hasGeneratedViews = generatedInitialViewId !== null;',
    'export function isGeneratedViewId(viewId: string): boolean {',
    '  return generatedNavigationGroups.some((group) => group.items.some((item) => item.id === viewId));',
    '}',
    'export function generatedViewLabel(viewId: string): string {',
    '  for (const group of generatedNavigationGroups) {',
    '    const item = group.items.find((candidate) => candidate.id === viewId);',
    '    if (item) return item.label;',
    '  }',
    '  return viewId;',
    '}',
    '',
  ].join('\n');
}

function renderGeneratedRouteRegistry(resolution) {
  const aiModules = aiStudioFeatureModules(resolution);
  const componentModules = componentFeatureModules(resolution);
  const imports = [
    "import { useEffect, useRef, type ReactNode } from 'react';",
    "import { generatedViewLabel } from './navigation.js';",
  ];
  if (aiModules.length > 0) {
    imports.push(
      "import { generatedAIStudioRegistrations } from './capability-registry.js';",
      "import { GeneratedAIStudioHost, GeneratedAIStudioRoute } from './host-adapters.js';",
    );
  }
  for (const module of componentModules) {
    imports.push(
      `import { ${module.productEntry.componentExport} } from '${generatedModuleImportPath(module)}';`,
    );
  }
  if (componentModules.some((module) => module.productEntry.identityProp)) {
    imports.push("import { appId } from '../../shell/auth/app-identity.js';");
  }
  const branches = [];
  if (aiModules.length > 0) {
    branches.push(
      '  if (generatedAIStudioRegistrations.some((registration) => registration.descriptor.id === activeViewId)) {',
      '    content = <GeneratedAIStudioRoute capabilityId={activeViewId} />;',
      '  }',
    );
  }
  for (const module of componentModules) {
    const identityProp = module.productEntry.identityProp
      ? ` ${module.productEntry.identityProp}={appId}`
      : '';
    branches.push(
      `  if (activeViewId === ${JSON.stringify(module.views[0])}) content = <${module.productEntry.componentExport}${identityProp} />;`,
    );
  }
  return [
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    'export function GeneratedModuleHost({',
    '  onSelectView,',
    '  children,',
    '}: {',
    '  readonly onSelectView: (viewId: string) => void;',
    '  readonly children: ReactNode;',
    '}) {',
    ...(aiModules.length > 0
      ? ['  return <GeneratedAIStudioHost onSelectCapability={onSelectView}>{children}</GeneratedAIStudioHost>;']
      : ['  return <>{children}</>;']),
    '}',
    '',
    'export function GeneratedRouteRegistry({',
    '  activeViewId,',
    '  onSelectView,',
    '}: {',
    '  readonly activeViewId: string;',
    '  readonly onSelectView: (viewId: string) => void;',
    '}) {',
    '  const rootRef = useRef<HTMLDivElement>(null);',
    '  useEffect(() => { rootRef.current?.focus(); }, [activeViewId]);',
    '  let content: ReactNode = null;',
    ...branches,
    '  if (!content) return null;',
    '  return (',
    '    <div',
    '      ref={rootRef}',
    '      tabIndex={-1}',
    '      role="region"',
    '      aria-label={generatedViewLabel(activeViewId)}',
    '      data-generated-view-id={activeViewId}',
    '      className="h-full min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nimi-focus-ring-color)]"',
    '    >',
    '      {content}',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function renderGeneratedModuleStyles(resolution) {
  const imports = [];
  if (hasAIStudioResolution(resolution)) {
    const core = resolvedAIStudioCore(resolution);
    for (const style of core.styles) {
      const mapping = core.sourceMappings.find((candidate) => (
        style === candidate.sourceRoot || style.startsWith(`${candidate.sourceRoot}/`)
        || style === candidate.targetRoot || style.startsWith(`${candidate.targetRoot}/`)
      ));
      if (!mapping) throw new Error(`Generated AI Studio style is outside the AI core source mappings: ${style}`);
      const sourceBased = style === mapping.sourceRoot || style.startsWith(`${mapping.sourceRoot}/`);
      const suffix = sourceBased
        ? style.slice(mapping.sourceRoot.length).replace(/^\//u, '')
        : style.slice(mapping.targetRoot.length).replace(/^\//u, '');
      const target = `${mapping.targetRoot}${suffix ? `/${suffix}` : ''}`.replace(/^src\//u, '');
      imports.push(`@import "../../${target}";`);
    }
  }
  return `${imports.join('\n')}${imports.length > 0 ? '\n' : ''}`;
}

function renderGeneratedAIStudioI18n() {
  return [
    "import i18next from 'i18next';",
    "import { generatedAIStudioMessageBundles } from './capability-registry.js';",
    '',
    "export const generatedLocale = globalThis.navigator?.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';",
    'const generatedI18n = i18next.createInstance();',
    'void generatedI18n.init({',
    '  lng: generatedLocale,',
    "  fallbackLng: 'en',",
    '  initImmediate: false,',
    '  interpolation: { escapeValue: false },',
    '  resources: {',
    '    en: { translation: generatedAIStudioMessageBundles.en },',
    '    zh: { translation: generatedAIStudioMessageBundles.zh },',
    '  },',
    '});',
    '',
    'export function translateGeneratedMessage(',
    '  key: string,',
    '  values?: Readonly<Record<string, unknown>>,',
    '): string {',
    '  return String(generatedI18n.t(key, values ? { ...values } : undefined));',
    '}',
    '',
  ].join('\n');
}

function renderGeneratedAIStudioHostAdapter(resolution) {
  const core = resolvedAIStudioCore(resolution);
  const coreImportPath = generatedModuleImportPath(core);
  const workspaceExport = core.productEntry.componentExport;
  return [
    "import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';",
    "import { createNimiClientId } from '@nimiplatform/sdk/types';",
    "import { ModelConfigAIConfigSurface, type ModelConfigLocalSelectionProjection } from '@nimiplatform/kit/features/model-config';",
    "import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';",
    "import { StatusBadge } from '@nimiplatform/kit/ui';",
    'import {',
    '  AIStudioHostProvider,',
    `  ${workspaceExport},`,
    '  createStudioNonSuccess,',
    '  createStudioRunTargetSummary,',
    '  createEmptyStudioPromptDraftStore,',
    '  loadStudioAIConfig,',
    '  parseStudioPromptDraftStore,',
    '  projectStudioManagedHistory,',
    '  readStudioPromptDraft,',
    '  runStudioCapability,',
    '  subscribeStudioAIConfigRefresh,',
    '  updateStudioPromptDraftStore,',
    '  useAIStudioWorkspaceController,',
    '  type AIStudioHistoryMutationOutcome,',
    '  type AIStudioHistoryPanelPreferences,',
    '  type AIStudioHistoryProjection,',
    '  type AIStudioHistoryRepository,',
    '  type AIStudioHostPort,',
    '  type AIStudioWorkspaceController,',
    '  type StudioPromptDraftStore,',
    '  type StudioRunHistory,',
    '  type StudioRunHistoryRecord,',
    '  type StudioRuntimeInspection,',
    `} from '${coreImportPath}';`,
    "import { appId, appTitle } from '../../shell/auth/app-identity.js';",
    "import { getNimiLocalAppClient } from '../../shell/auth/local-app-client.js';",
    "import { getRuntimePlatformProjection } from '../../shell/auth/runtime-platform.js';",
    'import {',
    '  generatedAIStudioComposition,',
    '  generatedAIStudioRegistrations,',
    "} from './capability-registry.js';",
    "import { generatedStudioRuntimeHandlers } from './runtime-registry.js';",
    "import { generatedLocale, translateGeneratedMessage } from './i18n.js';",
    '',
    "const HISTORY_PATH = 'ai-studio/run-history.v1.json';",
    "const PROMPT_DRAFT_STORAGE_KEY = 'nimi.ai-studio.prompt-drafts.v1';",
    'const HISTORY_LIMIT_PER_CAPABILITY = 40;',
    'const translate: AIStudioHostPort[\'translate\'] = translateGeneratedMessage;',
    '',
    'async function inspectTargetRuntime(): Promise<StudioRuntimeInspection> {',
    '  const projection = await getRuntimePlatformProjection();',
    "  if (projection.status === 'ready') {",
    "    return { status: 'connected', mode: projection.mode, detail: 'The protected local-app Runtime session is connected.' };",
    '  }',
    "  return { status: 'unavailable', mode: projection.mode, detail: projection.message };",
    '}',
    '',
    'function reasonCode(error: unknown): string {',
    "  if (!error || typeof error !== 'object') return '';",
    '  const value = (error as { readonly reasonCode?: unknown; readonly code?: unknown }).reasonCode',
    '    ?? (error as { readonly code?: unknown }).code;',
    "  return typeof value === 'string' ? value.trim().toUpperCase().replaceAll('-', '_') : '';",
    '}',
    '',
    'function isStorageEntryNotFound(error: unknown): boolean {',
    '  const normalized = reasonCode(error);',
    '  return normalized === \'APP_STORAGE_ENTRY_NOT_FOUND\'',
    "    || normalized === 'NOT_FOUND'",
    "    || normalized === 'ENTRY_NOT_FOUND'",
    "    || normalized.endsWith('_STORAGE_JSON_NOT_FOUND')",
    "    || normalized.endsWith('_STORAGE_ENTRY_NOT_FOUND')",
    "    || normalized.endsWith('_LOCAL_ASSET_NOT_FOUND');",
    '}',
    '',
    'function isObject(value: unknown): value is Record<string, unknown> {',
    "  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);",
    '}',
    '',
    'function parseHistory(value: unknown): StudioRunHistory {',
    '  if (!isObject(value)) throw new Error(\'AI Studio history requires an object.\');',
    '  for (const [capabilityId, records] of Object.entries(value)) {',
    "    if (!capabilityId || !Array.isArray(records)) throw new Error('AI Studio history capability bucket is invalid.');",
    '    for (const record of records) {',
    '      if (!isObject(record)',
    "        || typeof record.id !== 'string'",
    "        || typeof record.capabilityId !== 'string'",
    "        || typeof record.prompt !== 'string'",
    "        || typeof record.status !== 'string'",
    "        || typeof record.message !== 'string'",
    "        || typeof record.createdAt !== 'string') {",
    "        throw new Error('AI Studio history record is invalid.');",
    '      }',
    '    }',
    '  }',
    '  return value as StudioRunHistory;',
    '}',
    '',
    'async function loadRunHistory(): Promise<StudioRunHistory> {',
    '  try {',
    '    const document = await getNimiLocalAppClient().storage.readJson(HISTORY_PATH);',
    '    return parseHistory(document.value);',
    '  } catch (error) {',
    '    if (isStorageEntryNotFound(error)) return {};',
    '    throw error;',
    '  }',
    '}',
    '',
    'async function writeRunHistory(history: StudioRunHistory): Promise<StudioRunHistory> {',
    '  const normalized = parseHistory(JSON.parse(JSON.stringify(history)) as unknown);',
    '  await getNimiLocalAppClient().storage.writeJson(HISTORY_PATH, normalized as never);',
    '  return normalized;',
    '}',
    '',
    'let historyMutationTail: Promise<unknown> = Promise.resolve();',
    'function mutateHistory<TValue>(operation: () => Promise<TValue>): Promise<TValue> {',
    '  const next = historyMutationTail.then(operation, operation);',
    '  historyMutationTail = next.then(() => undefined, () => undefined);',
    '  return next;',
    '}',
    '',
    'function artifactPaths(record: StudioRunHistoryRecord): string[] {',
    '  const result = record.result;',
    "  if (!result || result.ok === false || result.kind !== 'artifacts') return [];",
    '  const artifacts = result.artifacts ?? (result.firstArtifact ? [result.firstArtifact] : []);',
    "  return artifacts.map((artifact) => artifact.relativePath).filter((path): path is string => typeof path === 'string' && path.length > 0);",
    '}',
    '',
    'async function cleanupArtifacts(relativePaths: readonly string[]) {',
    '  const failures: string[] = [];',
    '  const remainingCleanupPaths: string[] = [];',
    '  for (const relativePath of [...new Set(relativePaths)]) {',
    '    try {',
    '      await getNimiLocalAppClient().storage.assets.remove(relativePath);',
    '    } catch (error) {',
    '      if (isStorageEntryNotFound(error)) continue;',
    '      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);',
    '      remainingCleanupPaths.push(relativePath);',
    '    }',
    '  }',
    '  return { failures, remainingCleanupPaths };',
    '}',
    '',
    'async function verifyHistoryProjection(runHistory: StudioRunHistory): Promise<AIStudioHistoryProjection> {',
    '  return projectStudioManagedHistory({',
    '    runHistory,',
    '    resolveCapabilityLabel: (capabilityId) => generatedAIStudioRegistrations.find((entry) => (',
    '      entry.descriptor.id === capabilityId',
    '    ))?.descriptor.label ?? capabilityId,',
    '    inspectArtifact: async (artifact) => {',
    '      try {',
    '        const stored = await getNimiLocalAppClient().storage.assets.stat(artifact.relativePath);',
    '        if (stored.sha256 !== artifact.sha256 || stored.sizeBytes !== artifact.sizeBytes) {',
    "          return { status: 'unavailable', message: `Managed artifact verification failed: ${artifact.relativePath}` };",
    '        }',
    "        return { status: 'ready' };",
    '      } catch (error) {',
    '        if (!isStorageEntryNotFound(error)) throw error;',
    "        return { status: 'unavailable', message: `Managed artifact is unavailable: ${artifact.relativePath}` };",
    '      }',
    '    },',
    '  });',
    '}',
    '',
    'async function loadVerifiedHistory(): Promise<AIStudioHistoryProjection> {',
    '  return verifyHistoryProjection(await loadRunHistory());',
    '}',
    '',
    'async function appendRecord(record: StudioRunHistoryRecord): Promise<AIStudioHistoryProjection> {',
    '  return mutateHistory(async () => {',
    '    const current = await loadRunHistory();',
    '    const next = {',
    '      ...current,',
    '      [record.capabilityId]: [record, ...(current[record.capabilityId] ?? [])]',
    '        .slice(0, HISTORY_LIMIT_PER_CAPABILITY),',
    '    };',
    '    return verifyHistoryProjection(await writeRunHistory(next));',
    '  });',
    '}',
    '',
    'async function persistHistory({ result, record }: { readonly result: Parameters<AIStudioHistoryRepository[\'persist\']>[0][\'result\']; readonly record: StudioRunHistoryRecord }) {',
    '  try {',
    '    return { ok: true as const, projection: await appendRecord(record) };',
    '  } catch (error) {',
    '    const paths = artifactPaths(record);',
    '    const cleanup = await cleanupArtifacts(paths);',
    "    const message = error instanceof Error ? error.message : String(error || 'History persistence failed.');",
    '    return {',
    '      ok: false as const,',
    '      message,',
    '      retryRecord: paths.length === 0,',
    '      remainingCleanupPaths: cleanup.remainingCleanupPaths,',
    '      ...(paths.length > 0 ? {',
    "        displayFailure: { reason: 'runtime-call-failed' as const, message: `Runtime completed, but managed artifact history persistence failed: ${message}` },",
    '      } : {}),',
    '    };',
    '  }',
    '}',
    '',
    'function mutationFailure(',
    '  projection: AIStudioHistoryProjection,',
    '  records: readonly StudioRunHistoryRecord[],',
    "  step: 'asset' | 'history',",
    '  messages: readonly string[],',
    '): AIStudioHistoryMutationOutcome {',
    '  return {',
    '    completed: 0,',
    '    skipped: records.length,',
    '    failed: messages.length,',
    '    projection,',
    '    issues: records.map((record, index) => ({',
    '      runId: record.id,',
    '      step,',
    "      message: messages[index] ?? messages[0] ?? 'History mutation failed.',",
    '    })),',
    '  };',
    '}',
    '',
    'async function removeHistoryRecord(recordId: string, deleteAssets: boolean): Promise<AIStudioHistoryMutationOutcome> {',
    '  return mutateHistory(async () => {',
    '    const current = await loadRunHistory();',
    '    const removed = Object.values(current).flat().filter((record) => record.id === recordId);',
    '    const currentProjection = await verifyHistoryProjection(current);',
    '    if (removed.length === 0) return { completed: 0, skipped: 1, failed: 0, projection: currentProjection, issues: [] };',
    '    if (deleteAssets) {',
    '      const cleanup = await cleanupArtifacts(removed.flatMap(artifactPaths));',
    '      if (cleanup.failures.length > 0) return mutationFailure(await verifyHistoryProjection(current), removed, \'asset\', cleanup.failures);',
    '    }',
    '    const next = Object.fromEntries(Object.entries(current).map(([id, records]) => [',
    '      id, records.filter((record) => record.id !== recordId),',
    '    ]));',
    '    try {',
    '      await writeRunHistory(next);',
    '      return { completed: removed.length, skipped: 0, failed: 0, projection: await verifyHistoryProjection(next), issues: [] };',
    '    } catch (error) {',
    "      return mutationFailure(await verifyHistoryProjection(current), removed, 'history', [error instanceof Error ? error.message : String(error)]);",
    '    }',
    '  });',
    '}',
    '',
    'async function clearHistory(capabilityId: string | null, deleteAssets: boolean): Promise<AIStudioHistoryMutationOutcome> {',
    '  return mutateHistory(async () => {',
    '    const current = await loadRunHistory();',
    '    const removed = capabilityId ? (current[capabilityId] ?? []) : Object.values(current).flat();',
    '    const currentProjection = await verifyHistoryProjection(current);',
    '    if (deleteAssets) {',
    '      const cleanup = await cleanupArtifacts(removed.flatMap(artifactPaths));',
    '      if (cleanup.failures.length > 0) return mutationFailure(await verifyHistoryProjection(current), removed, \'asset\', cleanup.failures);',
    '    }',
    '    const next: Record<string, StudioRunHistoryRecord[]> = capabilityId ? { ...current } : {};',
    '    if (capabilityId) delete next[capabilityId];',
    '    try {',
    '      await writeRunHistory(next);',
    '      return { completed: removed.length, skipped: 0, failed: 0, projection: await verifyHistoryProjection(next), issues: [] };',
    '    } catch (error) {',
    "      return mutationFailure(await verifyHistoryProjection(current), removed, 'history', [error instanceof Error ? error.message : String(error)]);",
    '    }',
    '  });',
    '}',
    '',
    "const HISTORY_PANEL_STORAGE_KEY = 'nimi.ai-studio.history-panel.v1';",
    "const DEFAULT_HISTORY_PANEL: AIStudioHistoryPanelPreferences = Object.freeze({ collapsed: true, scope: 'capability', hideFailures: false });",
    'function loadPanelPreferences(): AIStudioHistoryPanelPreferences {',
    '  try {',
    '    const raw = globalThis.localStorage?.getItem(HISTORY_PANEL_STORAGE_KEY);',
    '    if (!raw) return DEFAULT_HISTORY_PANEL;',
    '    const value: unknown = JSON.parse(raw);',
    "    if (!isObject(value) || typeof value.collapsed !== 'boolean' || typeof value.hideFailures !== 'boolean'",
    "      || !['capability', 'all', 'media'].includes(String(value.scope))) return DEFAULT_HISTORY_PANEL;",
    '    return { collapsed: value.collapsed, scope: value.scope as AIStudioHistoryPanelPreferences[\'scope\'], hideFailures: value.hideFailures };',
    '  } catch { return DEFAULT_HISTORY_PANEL; }',
    '}',
    'function savePanelPreferences(preferences: AIStudioHistoryPanelPreferences): void {',
    '  try { globalThis.localStorage?.setItem(HISTORY_PANEL_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* UI state remains session-local. */ }',
    '}',
    '',
    'const historyRepository: AIStudioHistoryRepository = Object.freeze({',
    '  load: loadVerifiedHistory,',
    '  persist: persistHistory,',
    '  appendRecord,',
    '  cleanupArtifacts,',
    '  remove: removeHistoryRecord,',
    '  clear: clearHistory,',
    "  nextIdentity: async () => ({ runId: createNimiClientId('run'), createdAt: new Date().toISOString() }),",
    '  loadPanelPreferences,',
    '  savePanelPreferences,',
    '});',
    '',
    'let promptDraftStore = readPromptDraftStore();',
    '',
    'function readPromptDraftStore(): StudioPromptDraftStore {',
    '  try {',
    '    const raw = globalThis.localStorage?.getItem(PROMPT_DRAFT_STORAGE_KEY);',
    '    if (!raw) return createEmptyStudioPromptDraftStore();',
    '    return parseStudioPromptDraftStore(JSON.parse(raw));',
    '  } catch {',
    '    return createEmptyStudioPromptDraftStore();',
    '  }',
    '}',
    '',
    'async function savePromptDraft(key: Parameters<AIStudioHostPort[\'app\'][\'commands\'][\'savePromptDraft\']>[0], prompt: string, enabled: boolean) {',
    '  const next = updateStudioPromptDraftStore(promptDraftStore, key, prompt, enabled);',
    '  if (next === promptDraftStore) return promptDraftStore;',
    '  promptDraftStore = next;',
    '  try { globalThis.localStorage?.setItem(PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(promptDraftStore)); } catch { /* UI state remains session-local. */ }',
    '  return promptDraftStore;',
    '}',
    '',
    'function downloadBlob(filename: string, blob: Blob): void {',
    '  const url = URL.createObjectURL(blob);',
    "  const anchor = document.createElement('a');",
    '  anchor.href = url;',
    '  anchor.download = filename;',
    '  anchor.click();',
    '  queueMicrotask(() => URL.revokeObjectURL(url));',
    '}',
    '',
    'const RUN_STATUS_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({',
    "    ready: 'StudioShell.runStatusReady',",
    "    unavailable: 'StudioShell.runStatusUnavailable',",
    "    failed: 'StudioShell.runStatusFailed',",
    "    canceled: 'StudioShell.runStatusCanceled',",
    "    'timed-out': 'StudioShell.runStatusTimedOut',",
    '});',
    'function runStatusLabel(status: string): string {',
    '  const key = RUN_STATUS_LABEL_KEYS[status];',
    '  return key ? translate(key) : status;',
    '}',
    '',
    'const hostValue: AIStudioHostPort = {',
    '  appTitle,',
    '  translate,',
    '  locale: generatedLocale,',
    '  clock: { now: () => Date.now() },',
    '  app: {',
    '    projection: {',
    '      promptDraft: (key, enabled) => ({ prompt: readStudioPromptDraft(promptDraftStore, key, enabled) }),',
    '      projectRunTarget: createStudioRunTargetSummary,',
    '      runStatusLabel,',
    '    },',
    '    events: {',
    '      subscribeAIConfigRefresh: (listener) => subscribeStudioAIConfigRefresh(listener, window, document),',
    '    },',
    '    commands: {',
    '      savePromptDraft,',
    '      async copyText(text) {',
    '        try {',
    '          await navigator.clipboard.writeText(text);',
    '          return { ok: true, value: { copied: true } };',
    '        } catch (error) {',
    '          return { ok: false, error };',
    '        }',
    '      },',
    "      exportText: async ({ filename, body }) => downloadBlob(filename, new Blob([body], { type: 'text/plain;charset=utf-8' })),",
    '      async exportArtifact({ filename, url }) {',
    '        const response = await fetch(url);',
    "        if (!response.ok) throw new Error(`Artifact export failed (${response.status}).`);",
    '        downloadBlob(filename, await response.blob());',
    '      },',
    '    },',
    '  },',
    '  sdk: {',
    '    runCapability: (input) => runStudioCapability(input, {',
    '      appId,',
    "      surfaceId: 'ai-capabilities',",
    "      abortReason: 'studio-user-canceled',",
    '      handlers: generatedStudioRuntimeHandlers,',
    '      resolveCapability: (capabilityId) => generatedAIStudioComposition.getCapability(capabilityId).descriptor,',
    '      inspectRuntime: inspectTargetRuntime,',
    '      getClient: getNimiLocalAppClient,',
    "      createScenarioId: (capability) => `studio:${capability.id}`,",
    '      nonSuccess: (capability, reason, message, diagnostics) => (',
    '        createStudioNonSuccess(capability, reason, message, translate, diagnostics)',
    '      ),',
    '    }),',
    '    async listLocalAppVoiceAssets() {',
    "      const result = await getNimiLocalAppClient().ai.voiceAssets.list({ pageSize: 100, pageToken: '' });",
    '      return result.assets.map((asset) => ({',
    '        voiceAssetId: asset.voiceAssetId,',
    '        creationSource: asset.creationSource,',
    '        status: asset.status,',
    '      }));',
    '    },',
    '    uploadLocalAppArtifact: (input) => getNimiLocalAppClient().ai.artifacts.upload(input),',
    '    aiConfig: {',
    '      get: () => loadStudioAIConfig(getNimiLocalAppClient().aiConfig, appId),',
    '    },',
    '  },',
    '};',
    '',
    'const generatedCapabilityContracts = Object.freeze([',
    '  ...new Set(generatedAIStudioRegistrations.flatMap((registration) => (',
    '    registration.descriptor.capabilityContract ? [registration.descriptor.capabilityContract] : []',
    '  ))),',
    ']);',
    '',
    'function GeneratedAIConfigPanel({',
    '  runtime,',
    '  capabilityId,',
    '}: {',
    '  readonly runtime: StudioRuntimeInspection | null;',
    '  readonly capabilityId: string;',
    '}) {',
    '  const [config, setConfig] = useState<Awaited<ReturnType<typeof loadStudioAIConfig>>>(null);',
    '  const [localSelections, setLocalSelections] = useState<readonly ModelConfigLocalSelectionProjection[]>([]);',
    '  const [loading, setLoading] = useState(true);',
    '  const [loadError, setLoadError] = useState<string | null>(null);',
    '  const refresh = async () => {',
    '    setLoading(true);',
    '    setLoadError(null);',
    '    try {',
    '      setConfig(await loadStudioAIConfig(getNimiLocalAppClient().aiConfig, appId));',
    '      try {',
    '        setLocalSelections(await getNimiLocalAppClient().modelConfig.localSelections());',
    '      } catch {',
    '        setLocalSelections(generatedCapabilityContracts.map((capabilityContract) => ({',
    '          capabilityContract,',
    "          state: 'unavailable' as const,",
    '          loadoutId: null,',
    '          displayName: null,',
    '          supportedFeatures: [],',
    "          reasons: ['machine-loadout-unavailable'],",
    '          effectiveDefaults: null,',
    '        })));',
    '      }',
    '    } catch (error) {',
    "      setLoadError(error instanceof Error ? error.message : String(error || 'AIConfig load failed.'));",
    '    } finally {',
    '      setLoading(false);',
    '    }',
    '  };',
    '  useEffect(() => {',
    '    void refresh();',
    '    return subscribeStudioAIConfigRefresh(() => { void refresh(); }, window, document);',
    '  }, []);',
    '  const runtimeLabel = runtime?.status === \'connected\'',
    "    ? translate('StudioShell.statusConfigured')",
    "    : translate('StudioShell.statusNotAdmitted');",
    '  return (',
    '    <section className="flex h-full min-h-0 flex-col" aria-label={translate(\'StudioModelConfig.drawerDescription\', { appTitle })}>',
    '      <div className="min-h-0 flex-1 overflow-y-auto p-5">',
    '        <ModelConfigAIConfigSurface',
    "          context={{ owner: 'app-ai-config', consumer: 'third-party-app', appId }}",
    '          capabilityContracts={generatedCapabilityContracts}',
    '          initialCapabilityContract={capabilityId}',
    '          capabilities={loading || loadError ? undefined : config ? config.capabilities as never : null}',
    '          localSelections={localSelections}',
    '          loading={loading}',
    '          loadError={loadError}',
    '          onRetry={() => { void refresh(); }}',
    '          onOpenOwnerConfiguration={() => {',
    '            void openDesktopIntent({',
    "              requestId: createNimiClientId('desktop-open'),",
    "              intent: { kind: 'open-apps', appId, section: 'ai-models' },",
    '            });',
    '          }}',
    '          copy={{',
    "            title: translate('StudioModelConfig.drawerTitle'),",
    "            description: translate('StudioModelConfig.drawerDescription', { appTitle }),",
    '            capabilityLabel: (contract, fallback) => (',
    '              generatedAIStudioRegistrations.find((entry) => entry.descriptor.capabilityContract === contract)',
    '                ? translate(generatedAIStudioRegistrations.find((entry) => entry.descriptor.capabilityContract === contract)!.descriptor.labelKey)',
    '                : fallback',
    '            ),',
    '          }}',
    '          headerSlot={<StatusBadge tone={runtime?.status === \'connected\' ? \'neutral\' : \'warning\'} shape="dot">{runtimeLabel}</StatusBadge>}',
    '        />',
    '      </div>',
    '    </section>',
    '  );',
    '}',
    '',
    'type GeneratedAIStudioState = {',
    '  readonly runtime: StudioRuntimeInspection | null;',
    '  readonly controller: AIStudioWorkspaceController;',
    '};',
    'const GeneratedAIStudioStateContext = createContext<GeneratedAIStudioState | null>(null);',
    '',
    'export function GeneratedAIStudioHost({',
    '  onSelectCapability,',
    '  children,',
    '}: {',
    '  readonly onSelectCapability: (capabilityId: string) => void;',
    '  readonly children: ReactNode;',
    '}) {',
    '  const [runtime, setRuntime] = useState<StudioRuntimeInspection | null>(null);',
    '  useEffect(() => {',
    '    let active = true;',
    '    void inspectTargetRuntime().then((next) => { if (active) setRuntime(next); });',
    '    return () => { active = false; };',
    '  }, []);',
    '  const controller = useAIStudioWorkspaceController({',
    '    historyRepository,',
    '    registrations: generatedAIStudioRegistrations,',
    '    onSelectCapability,',
    '    translate,',
    '  });',
    '  const state = useMemo(() => ({ runtime, controller }), [controller, runtime]);',
    '  return (',
    '    <AIStudioHostProvider value={hostValue}>',
    '      <GeneratedAIStudioStateContext.Provider value={state}>',
    '        {children}',
    '      </GeneratedAIStudioStateContext.Provider>',
    '    </AIStudioHostProvider>',
    '  );',
    '}',
    '',
    'function useGeneratedAIStudioState(): GeneratedAIStudioState {',
    '  const state = useContext(GeneratedAIStudioStateContext);',
    "  if (!state) throw new Error('GENERATED_AI_STUDIO_HOST_UNAVAILABLE');",
    '  return state;',
    '}',
    '',
    'export function GeneratedAIStudioRoute({',
    '  capabilityId,',
    '}: {',
    '  readonly capabilityId: string;',
    '}) {',
    '  const { runtime, controller } = useGeneratedAIStudioState();',
    '  const registration = useMemo(() => (',
    '    generatedAIStudioRegistrations.find((entry) => entry.descriptor.id === capabilityId)',
    '      ?? generatedAIStudioRegistrations[0]',
    '  ), [capabilityId]);',
    '  if (!registration) return null;',
    '  return (',
    `    <${workspaceExport}`,
    '        registration={registration}',
    '        registrations={generatedAIStudioRegistrations}',
    '        runtime={runtime}',
    '        controller={controller}',
    '        renderAIConfigPanel={(input) => <GeneratedAIConfigPanel {...input} />}',
    '        rootTestId="nimi-app-ai-studio"',
    '      />',
    '  );',
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
    `const NATIVE_BUNDLE_IDENTIFIER = ${JSON.stringify(identity.nativeBundleIdentifier)};`,
    "const currentDir = path.dirname(fileURLToPath(import.meta.url));",
    "const appRoot = path.resolve(currentDir, '..');",
    "const preloadPath = path.join(currentDir, 'preload.cjs');",
    "const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();",
    'const developmentRendererUrl = readDevelopmentRendererUrl();',
    'const rendererUrl = developmentRendererUrl || productionRendererUrl;',
    'const allowedRendererUrls = [rendererUrl];',
    '',
    `app.setName(${JSON.stringify(identity.appTitle)});`,
    'app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);',
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
