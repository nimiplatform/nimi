import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppOriginEvent } from '../driver/types.js';
import {
  activityHandlerKey,
  handlerFilenameToActivityId,
  handlerFilenameToEventName,
} from './activity-naming.js';
import {
  assertSandboxSourcePolicy,
  collectStaticImports,
  validateSandboxSourcePolicy,
} from './handler-sandbox-policy.js';
import type {
  ActivityOrEventHandler,
  ContinuousHandler,
  RegisteredActivityHandler,
  RegisteredContinuousHandler,
  RegisteredEventHandler,
} from './handler-types.js';
import {
  createSandboxedActivityOrEventHandler,
  createSandboxedContinuousHandler,
  type SandboxWorkerFactory,
} from './handler-sandbox.js';

type RustHandlerEntry = { file_stem: string; absolute_path: string };
type RustNasManifest = {
  activity: RustHandlerEntry[];
  event: RustHandlerEntry[];
  continuous: RustHandlerEntry[];
  config_json_path: string | null;
};

export type NasManifest = {
  activity: RustHandlerEntry[];
  event: RustHandlerEntry[];
  continuous: RustHandlerEntry[];
  configJsonPath: string | null;
  nimiDir?: string;
};

export type NasConfig = {
  nas_version?: string;
  model_id?: string;
  history_context?: {
    enabled?: boolean;
    window_seconds?: number;
    track?: string[];
  };
  features?: Record<string, boolean>;
  default_idle_motion?: string;
  default_fallback_motion?: string;
};

export async function scanNasHandlers(nimiDir: string): Promise<NasManifest> {
  const raw = await invoke<RustNasManifest>('nimi_avatar_scan_nas_handlers', { nimiDir });
  return {
    activity: raw.activity,
    event: raw.event,
    continuous: raw.continuous,
    configJsonPath: raw.config_json_path,
    nimiDir,
  };
}

async function readSource(path: string): Promise<string> {
  return invoke<string>('nimi_avatar_read_text_file', { path });
}

function isActivityOrEventHandler(value: unknown): value is ActivityOrEventHandler {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['execute'] === 'function'
  );
}

function isContinuousHandler(value: unknown): value is ContinuousHandler {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['update'] === 'function'
  );
}

export type HandlerRegistry = {
  activity: Map<string, RegisteredActivityHandler>;
  event: Map<string, RegisteredEventHandler>;
  continuous: Map<string, RegisteredContinuousHandler>;
  config: NasConfig | null;
};

export type PopulateRegistryResult = {
  validationErrors: string[];
  config: NasConfig | null;
};

export type RegistryReloadMode = 'add' | 'update' | 'remove';

export type RegistryReloadResult = {
  applied: boolean;
  reloadMode: RegistryReloadMode;
  validationErrors: string[];
  retiredRegistry: HandlerRegistry | null;
};

export type NasHandlersChangedPayload = {
  watcher_id: string;
  nimi_dir: string;
  changed_files: string[];
  reload_mode: RegistryReloadMode;
};

export const NAS_HANDLERS_CHANGED_EVENT = 'avatar://nas-handlers-changed';

export function createHandlerRegistry(): HandlerRegistry {
  return {
    activity: new Map(),
    event: new Map(),
    continuous: new Map(),
    config: null,
  };
}

export function disposeRegistry(registry: HandlerRegistry): void {
  for (const entry of registry.activity.values()) {
    entry.handler.dispose?.();
  }
  for (const entry of registry.event.values()) {
    entry.handler.dispose?.();
  }
  for (const entry of registry.continuous.values()) {
    entry.handler.dispose?.();
  }
  registry.activity.clear();
  registry.event.clear();
  registry.continuous.clear();
  registry.config = null;
}

export type PopulateRegistryOptions = {
  createWorker?: SandboxWorkerFactory;
  failOnError?: boolean;
};

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function runtimeNimiRootForSource(sourcePath: string): string | null {
  const normalized = normalizeSourcePath(sourcePath);
  const marker = '/runtime/nimi/';
  const index = normalized.indexOf(marker);
  if (index < 0) return null;
  return normalized.slice(0, index + marker.length - 1);
}

function resolveLibImportPath(sourcePath: string, specifier: string): string {
  const root = runtimeNimiRootForSource(sourcePath);
  if (!root) {
    throw new Error(`NAS handler source is outside runtime/nimi: ${sourcePath}`);
  }
  if (!specifier.startsWith('../lib/') || !specifier.endsWith('.js')) {
    throw new Error(`NAS handler import is outside runtime/nimi/lib: ${specifier}`);
  }
  const relative = specifier.slice('../lib/'.length);
  if (!relative || relative.includes('/') || relative.includes('..')) {
    throw new Error(`NAS handler lib import must reference a direct lib/*.js helper: ${specifier}`);
  }
  return `${root}/lib/${relative}`;
}

function transformLibSourceForInline(source: string, sourcePath: string): string {
  assertSandboxSourcePolicy(source, { kind: 'lib', sourcePath });
  return source
    .replace(/\bexport\s+async\s+function\s+/g, 'async function ')
    .replace(/\bexport\s+function\s+/g, 'function ')
    .replace(/\bexport\s+const\s+/g, 'const ')
    .replace(/\bexport\s+let\s+/g, 'let ');
}

function exportedNamesFromLib(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]!);
  }
  for (const match of source.matchAll(/\bexport\s+(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]!);
  }
  return names;
}

function importedNamesFromBindings(bindings: string): string[] {
  return bindings
    .replace(/^\{\s*/, '')
    .replace(/\s*\}$/, '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

async function bundleHandlerSource(source: string, sourcePath: string): Promise<string> {
  assertSandboxSourcePolicy(source, {
    kind: 'handler',
    sourcePath,
    allowLibImports: true,
  });
  const staticImports = collectStaticImports(source);
  if (staticImports.length === 0) return source;

  let bundledHandler = source;
  const inlineSources: string[] = [];
  const loadedLibs = new Set<string>();
  for (const imported of staticImports) {
    const libPath = resolveLibImportPath(sourcePath, imported.specifier);
    const libSource = await readSource(libPath);
    const exportedNames = exportedNamesFromLib(libSource);
    for (const importedName of importedNamesFromBindings(imported.bindings)) {
      if (!exportedNames.has(importedName)) {
        throw new Error(`NAS lib ${imported.specifier} does not export ${importedName}`);
      }
    }
    if (!loadedLibs.has(libPath)) {
      inlineSources.push(transformLibSourceForInline(libSource, libPath));
      loadedLibs.add(libPath);
    }
    bundledHandler = bundledHandler.replace(imported.statement, '');
  }
  const bundled = `${inlineSources.join('\n')}\n${bundledHandler}`;
  assertSandboxSourcePolicy(bundled, { kind: 'handler', sourcePath });
  return bundled;
}

async function readConfig(configJsonPath: string | null): Promise<NasConfig | null> {
  if (!configJsonPath) return null;
  const raw = await readSource(configJsonPath);
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('NAS config.json must contain a JSON object');
  }
  return parsed as NasConfig;
}

function validateHandlerEntryPath(entry: RustHandlerEntry, expectedDir: 'activity' | 'event' | 'continuous'): string | null {
  const path = normalizeSourcePath(entry.absolute_path);
  if (!path.endsWith(`/${expectedDir}/${entry.file_stem}.js`)) {
    return `NAS ${expectedDir} handler path does not match runtime/nimi/${expectedDir}/${entry.file_stem}.js: ${entry.absolute_path}`;
  }
  const policy = validateSandboxSourcePolicy('export default { execute() {} };', { sourcePath: entry.absolute_path });
  return policy.ok ? null : policy.reason;
}

function pushValidationError(validationErrors: string[], message: string): void {
  validationErrors.push(message);
  console.error(message);
}

export async function populateRegistry(
  registry: HandlerRegistry,
  manifest: NasManifest,
  options: PopulateRegistryOptions = {},
): Promise<PopulateRegistryResult> {
  const createWorker = options.createWorker;
  const validationErrors: string[] = [];
  try {
    registry.config = await readConfig(manifest.configJsonPath);
  } catch (err) {
    pushValidationError(
      validationErrors,
      `[nas] failed to load config.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const activityKeys = new Map<string, string>();
  for (const entry of manifest.activity) {
    const key = activityHandlerKey(entry.file_stem);
    const existing = activityKeys.get(key);
    if (existing) {
      pushValidationError(validationErrors, `[nas] duplicate normalized activity handler id ${key}: ${existing} and ${entry.file_stem}`);
      continue;
    }
    activityKeys.set(key, entry.file_stem);
    const pathError = validateHandlerEntryPath(entry, 'activity');
    if (pathError) {
      pushValidationError(validationErrors, `[nas] rejected activity handler ${entry.file_stem}: ${pathError}`);
      continue;
    }
    try {
      const source = await bundleHandlerSource(await readSource(entry.absolute_path), entry.absolute_path);
      const module = await createSandboxedActivityOrEventHandler(source, entry.absolute_path, createWorker);
      if (!isActivityOrEventHandler(module)) {
        pushValidationError(validationErrors, `[nas] activity handler ${entry.file_stem} has no execute()`);
        continue;
      }
      registry.activity.set(key, {
        kind: 'activity',
        activityId: handlerFilenameToActivityId(entry.file_stem + '.js') ?? entry.file_stem,
        handler: module,
        sourcePath: entry.absolute_path,
      });
    } catch (err) {
      const message = `[nas] failed to load activity handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`;
      validationErrors.push(message);
      console.error(message);
    }
  }

  const eventNames = new Map<string, string>();
  for (const entry of manifest.event) {
    const eventName = handlerFilenameToEventName(entry.file_stem + '.js');
    if (!eventName) {
      pushValidationError(validationErrors, `[nas] event handler ${entry.file_stem} has no matching event in registry`);
      continue;
    }
    const existing = eventNames.get(eventName);
    if (existing) {
      pushValidationError(validationErrors, `[nas] duplicate event handler for ${eventName}: ${existing} and ${entry.file_stem}`);
      continue;
    }
    eventNames.set(eventName, entry.file_stem);
    const pathError = validateHandlerEntryPath(entry, 'event');
    if (pathError) {
      pushValidationError(validationErrors, `[nas] rejected event handler ${entry.file_stem}: ${pathError}`);
      continue;
    }
    try {
      const source = await bundleHandlerSource(await readSource(entry.absolute_path), entry.absolute_path);
      const module = await createSandboxedActivityOrEventHandler(source, entry.absolute_path, createWorker);
      if (!isActivityOrEventHandler(module)) {
        pushValidationError(validationErrors, `[nas] event handler ${entry.file_stem} has no execute()`);
        continue;
      }
      registry.event.set(eventName, {
        kind: 'event',
        eventName,
        handler: module,
        sourcePath: entry.absolute_path,
      });
    } catch (err) {
      const message = `[nas] failed to load event handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`;
      validationErrors.push(message);
      console.error(message);
    }
  }

  const continuousIds = new Set<string>();
  for (const entry of manifest.continuous) {
    if (continuousIds.has(entry.file_stem)) {
      pushValidationError(validationErrors, `[nas] duplicate continuous handler id ${entry.file_stem}`);
      continue;
    }
    continuousIds.add(entry.file_stem);
    const pathError = validateHandlerEntryPath(entry, 'continuous');
    if (pathError) {
      pushValidationError(validationErrors, `[nas] rejected continuous handler ${entry.file_stem}: ${pathError}`);
      continue;
    }
    try {
      const source = await bundleHandlerSource(await readSource(entry.absolute_path), entry.absolute_path);
      const module = await createSandboxedContinuousHandler(source, entry.absolute_path, createWorker);
      if (!isContinuousHandler(module)) {
        pushValidationError(validationErrors, `[nas] continuous handler ${entry.file_stem} has no update()`);
        continue;
      }
      const fps = typeof module.fps === 'number' && module.fps > 0 ? module.fps : 60;
      registry.continuous.set(entry.file_stem, {
        kind: 'continuous',
        id: entry.file_stem,
        fps,
        handler: module,
        sourcePath: entry.absolute_path,
      });
    } catch (err) {
      const message = `[nas] failed to load continuous handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`;
      validationErrors.push(message);
      console.error(message);
    }
  }

  if (options.failOnError && validationErrors.length > 0) {
    return { validationErrors, config: registry.config };
  }
  return { validationErrors, config: registry.config };
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function countManifestHandlers(manifest: NasManifest): number {
  return manifest.activity.length + manifest.event.length + manifest.continuous.length;
}

function countRegistryHandlers(registry: HandlerRegistry): number {
  return registry.activity.size + registry.event.size + registry.continuous.size;
}

function cloneRegistry(registry: HandlerRegistry): HandlerRegistry {
  return {
    activity: new Map(registry.activity),
    event: new Map(registry.event),
    continuous: new Map(registry.continuous),
    config: registry.config,
  };
}

export async function reloadRegistry(
  registry: HandlerRegistry,
  manifest: NasManifest,
  input: {
    reloadMode: RegistryReloadMode;
    createWorker?: SandboxWorkerFactory;
  },
): Promise<RegistryReloadResult> {
  const next = createHandlerRegistry();
  const result = await populateRegistry(next, manifest, {
    createWorker: input.createWorker,
    failOnError: true,
  });
  if (result.validationErrors.length > 0 || countRegistryHandlers(next) !== countManifestHandlers(manifest)) {
    disposeRegistry(next);
    return {
      applied: false,
      reloadMode: input.reloadMode,
      validationErrors: result.validationErrors.length > 0
        ? result.validationErrors
        : ['NAS reload rejected because one or more handlers did not register.'],
      retiredRegistry: null,
    };
  }

  const retiredRegistry = cloneRegistry(registry);
  replaceMap(registry.activity, next.activity);
  replaceMap(registry.event, next.event);
  replaceMap(registry.continuous, next.continuous);
  registry.config = next.config;
  return {
    applied: true,
    reloadMode: input.reloadMode,
    validationErrors: [],
    retiredRegistry,
  };
}

function createNasWatcherId(modelId: string): string {
  const randomSuffix = Math.random().toString(16).slice(2);
  return `nas-${modelId}-${Date.now()}-${randomSuffix}`;
}

export async function startNasHandlerHotReload(input: {
  modelId: string;
  nimiDir: string;
  registry: HandlerRegistry;
  emit: (event: AppOriginEvent) => void;
  createWorker?: SandboxWorkerFactory;
}): Promise<() => Promise<void>> {
  const watcherId = createNasWatcherId(input.modelId);
  const retiredRegistries: HandlerRegistry[] = [];
  const unlisten: UnlistenFn = await listen<NasHandlersChangedPayload>(NAS_HANDLERS_CHANGED_EVENT, (event) => {
    const payload = event.payload;
    if (!payload || payload.watcher_id !== watcherId || payload.nimi_dir !== input.nimiDir) {
      return;
    }
    void (async () => {
      const manifest = await scanNasHandlers(input.nimiDir);
      const result = await reloadRegistry(input.registry, manifest, {
        reloadMode: payload.reload_mode,
        createWorker: input.createWorker,
      });
      if (result.retiredRegistry) {
        retiredRegistries.push(result.retiredRegistry);
      }
      input.emit({
        name: 'avatar.model.script.reloaded',
        detail: {
          model_id: input.modelId,
          changed_files: payload.changed_files,
          reload_mode: payload.reload_mode,
          applied: result.applied,
          validation_errors: result.validationErrors,
        },
      });
    })().catch((err: unknown) => {
      input.emit({
        name: 'avatar.model.script.reloaded',
        detail: {
          model_id: input.modelId,
          changed_files: payload.changed_files,
          reload_mode: payload.reload_mode,
          applied: false,
          validation_errors: [err instanceof Error ? err.message : String(err)],
        },
      });
    });
  });

  try {
    await invoke('nimi_avatar_watch_nas_handlers', { nimiDir: input.nimiDir, watcherId });
  } catch (err) {
    unlisten();
    throw err;
  }

  return async () => {
    unlisten();
    await invoke('nimi_avatar_unwatch_nas_handlers', { watcherId });
    for (const registry of retiredRegistries) {
      disposeRegistry(registry);
    }
    retiredRegistries.length = 0;
  };
}
