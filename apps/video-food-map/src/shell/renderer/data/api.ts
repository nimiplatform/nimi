import { invoke } from '@renderer/bridge/invoke.js';
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
