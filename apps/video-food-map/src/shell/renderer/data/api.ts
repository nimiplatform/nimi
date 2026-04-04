import { invoke } from '@renderer/bridge/invoke.js';
import { hasTauriInvoke } from '@renderer/bridge/env.js';
import {
  parseImportRecordResult,
  parseSnapshot,
  parseVideoFoodMapRuntimeOptions,
  parseVideoFoodMapSettings,
  type ImportRecord,
  type VideoFoodMapRuntimeOptions,
  type VideoFoodMapSettings,
  type VideoFoodMapSnapshot,
} from './types.js';

export async function loadSnapshot(): Promise<VideoFoodMapSnapshot> {
  return parseSnapshot(await invoke('video_food_map_snapshot'));
}

export async function importVideo(url: string): Promise<ImportRecord> {
  return parseImportRecordResult(await invoke('video_food_map_import_video', { url }));
}

export async function setVenueConfirmation(venueId: string, confirmed: boolean): Promise<ImportRecord> {
  return parseImportRecordResult(
    await invoke('video_food_map_set_venue_confirmation', { venueId, confirmed }),
  );
}

export async function toggleVenueFavorite(venueId: string): Promise<ImportRecord> {
  return parseImportRecordResult(await invoke('video_food_map_toggle_venue_favorite', { venueId }));
}

export async function loadVideoFoodMapSettings(): Promise<VideoFoodMapSettings> {
  return parseVideoFoodMapSettings(await invoke('video_food_map_settings_get'));
}

export async function saveVideoFoodMapSettings(settings: VideoFoodMapSettings): Promise<VideoFoodMapSettings> {
  return parseVideoFoodMapSettings(await invoke('video_food_map_settings_set', { settings }));
}

export async function loadVideoFoodMapRuntimeOptions(): Promise<VideoFoodMapRuntimeOptions> {
  return parseVideoFoodMapRuntimeOptions(await invoke('video_food_map_runtime_options_get'));
}

export async function openExternalUrl(url: string): Promise<void> {
  const normalized = String(url || '').trim();
  if (!normalized) {
    throw new Error('url is required');
  }

  if (hasTauriInvoke()) {
    await invoke('video_food_map_open_external_url', { url: normalized });
    return;
  }

  const openedWindow = window.open(normalized, '_blank', 'noopener,noreferrer');
  if (!openedWindow) {
    throw new Error('external url could not be opened');
  }
}
