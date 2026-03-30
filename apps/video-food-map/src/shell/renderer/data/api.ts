import { invoke } from '@renderer/bridge/invoke.js';
import { parseImportRecordResult, parseSnapshot, type ImportRecord, type VideoFoodMapSnapshot } from './types.js';

export async function loadSnapshot(): Promise<VideoFoodMapSnapshot> {
  return parseSnapshot(await invoke('video_food_map_snapshot'));
}

export async function importVideo(url: string): Promise<ImportRecord> {
  return parseImportRecordResult(await invoke('video_food_map_import_video', { url }));
}
