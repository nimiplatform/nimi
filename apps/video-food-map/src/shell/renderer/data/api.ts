import { invoke } from '@renderer/bridge/invoke.js';
import { parseImportRecordResult, parseSnapshot, type ImportRecord, type VideoFoodMapSnapshot } from './types.js';

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
