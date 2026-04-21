import { invoke } from '@tauri-apps/api/core';
import { handlerFilenameToEventName } from './activity-naming.js';
import type {
  ActivityOrEventHandler,
  ContinuousHandler,
  RegisteredActivityHandler,
  RegisteredContinuousHandler,
  RegisteredEventHandler,
} from './handler-types.js';

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

async function importFromSource(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const module = await import(/* @vite-ignore */ url);
    return (module as { default?: unknown }).default ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
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

export function createHandlerRegistry(): HandlerRegistry {
  return {
    activity: new Map(),
    event: new Map(),
    continuous: new Map(),
  };
}

export async function populateRegistry(registry: HandlerRegistry, manifest: NasManifest): Promise<void> {
  for (const entry of manifest.activity) {
    try {
      const source = await readSource(entry.absolute_path);
      const module = await importFromSource(source);
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
      console.error(`[nas] failed to load activity handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`);
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
      const module = await importFromSource(source);
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
      console.error(`[nas] failed to load event handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const entry of manifest.continuous) {
    try {
      const source = await readSource(entry.absolute_path);
      const module = await importFromSource(source);
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
      console.error(`[nas] failed to load continuous handler ${entry.file_stem}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
