import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppOriginEvent } from '../driver/types.js';
import { handlerFilenameToEventName } from './activity-naming.js';
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
};

export async function scanNasHandlers(nimiDir: string): Promise<NasManifest> {
  const raw = await invoke<RustNasManifest>('nimi_avatar_scan_nas_handlers', { nimiDir });
  return {
    activity: raw.activity,
    event: raw.event,
    continuous: raw.continuous,
    configJsonPath: raw.config_json_path,
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
};

export type PopulateRegistryResult = {
  validationErrors: string[];
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
}

export type PopulateRegistryOptions = {
  createWorker?: SandboxWorkerFactory;
  failOnError?: boolean;
};

export async function populateRegistry(
  registry: HandlerRegistry,
  manifest: NasManifest,
  options: PopulateRegistryOptions = {},
): Promise<PopulateRegistryResult> {
  const createWorker = options.createWorker;
  const validationErrors: string[] = [];
  for (const entry of manifest.activity) {
    try {
      const source = await readSource(entry.absolute_path);
      const module = await createSandboxedActivityOrEventHandler(source, entry.absolute_path, createWorker);
      if (!isActivityOrEventHandler(module)) {
        console.warn(`[nas] activity handler ${entry.file_stem} has no execute()`);
        continue;
      }
      registry.activity.set(entry.file_stem, {
        kind: 'activity',
        activityId: entry.file_stem,
        handler: module,
        sourcePath: entry.absolute_path,
      });
    } catch (err) {
      const message = `[nas] failed to load activity handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`;
      validationErrors.push(message);
      console.error(message);
    }
  }

  for (const entry of manifest.event) {
    const eventName = handlerFilenameToEventName(entry.file_stem + '.js');
    if (!eventName) {
      console.warn(`[nas] event handler ${entry.file_stem} has no matching event in registry — skipped`);
      continue;
    }
    try {
      const source = await readSource(entry.absolute_path);
      const module = await createSandboxedActivityOrEventHandler(source, entry.absolute_path, createWorker);
      if (!isActivityOrEventHandler(module)) {
        console.warn(`[nas] event handler ${entry.file_stem} has no execute()`);
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

  for (const entry of manifest.continuous) {
    try {
      const source = await readSource(entry.absolute_path);
      const module = await createSandboxedContinuousHandler(source, entry.absolute_path, createWorker);
      if (!isContinuousHandler(module)) {
        console.warn(`[nas] continuous handler ${entry.file_stem} has no update()`);
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
    return { validationErrors };
  }
  return { validationErrors };
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
