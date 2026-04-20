import type {
  ImportRecord,
  MapPoint,
  VenueRecord,
  VideoFoodMapDiningProfile,
  VideoFoodMapRouteSetting,
  VideoFoodMapRouteSource,
  VideoFoodMapRuntimeOption,
  VideoFoodMapRuntimeOptionsCatalog,
  VideoFoodMapSettings,
} from './data/types.js';

export type SurfaceId = 'discover' | 'nearby-map' | 'review' | 'menu';
export type RuntimeSettingsCapability = 'stt' | 'text';
export type PersonalMapMode = 'all' | 'favorites' | 'selected' | 'nearby';

export function formatImportTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isImportActive(status: ImportRecord['status']) {
  return status === 'queued' || status === 'resolving' || status === 'geocoding' || status === 'running';
}

export function venueShowsOnMap(venue: VenueRecord) {
  return (venue.reviewState === 'map_ready' || venue.userConfirmed) && venue.latitude != null && venue.longitude != null;
}

export function resolveImportTone(record: ImportRecord) {
  if (record.status === 'queued' || record.status === 'resolving' || record.status === 'geocoding' || record.status === 'running') {
    return 'warning' as const;
  }
  if (record.status === 'failed') {
    return 'danger' as const;
  }
  if (record.venues.some((venue) => venue.userConfirmed || venueShowsOnMap(venue))) {
    return 'success' as const;
  }
  if (record.venues.some((venue) => venue.reviewState === 'review')) {
    return 'warning' as const;
  }
  return 'info' as const;
}

export function resolveImportStatusLabel(record: ImportRecord) {
  switch (record.status) {
    case 'queued':
      return '排队中';
    case 'resolving':
    case 'running':
      return '解析中';
    case 'geocoding':
      return '定位中';
    case 'failed':
      return '失败';
    default:
      if (record.venues.some((venue) => venue.userConfirmed)) {
        return '已确认';
      }
      return record.venues.some((venue) => venueShowsOnMap(venue)) ? '已上图' : '待确认';
  }
}

export function resolveImportProgressText(record: ImportRecord | null) {
  if (!record) {
    return '';
  }
  switch (record.status) {
    case 'queued':
      return '已收到导入请求，正在排队开始处理。';
    case 'resolving':
    case 'running':
      return '正在拉取视频信息、字幕或音频，并做初步整理。长视频会更久一些。';
    case 'geocoding':
      return '文字结果已经出来了，正在谨慎处理地点信息。';
    case 'failed':
      return record.errorMessage || '这次导入失败了。';
    default:
      return '';
  }
}

export function resolveReviewTone(reviewState: 'all' | 'map_ready' | 'review' | 'search_only' | 'failed_import') {
  switch (reviewState) {
    case 'map_ready':
      return 'success' as const;
    case 'review':
      return 'warning' as const;
    case 'search_only':
      return 'info' as const;
    case 'failed_import':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

export function pickPreferredVenueId(record: ImportRecord | null): string | null {
  if (!record) {
    return null;
  }
  return (
    record.venues.find((venue) => venue.userConfirmed)?.id
    || record.venues.find((venue) => venueShowsOnMap(venue))?.id
    || record.venues[0]?.id
    || null
  );
}

export function buildMapPointFromVenue(record: ImportRecord, venue: VenueRecord): MapPoint | null {
  if (venue.latitude == null || venue.longitude == null) {
    return null;
  }
  return {
    venueId: venue.id,
    importId: record.id,
    venueName: venue.venueName,
    creatorName: record.creatorName,
    title: record.title,
    addressText: venue.addressText,
    latitude: venue.latitude,
    longitude: venue.longitude,
    isFavorite: venue.isFavorite,
    userConfirmed: venue.userConfirmed,
  };
}

export function createDefaultRouteSetting(): VideoFoodMapRouteSetting {
  return {
    routeSource: 'cloud',
    connectorId: '',
    model: '',
  };
}

export function createDefaultDiningProfile(): VideoFoodMapDiningProfile {
  return {
    dietaryRestrictions: [],
    tabooIngredients: [],
    flavorPreferences: [],
    cuisinePreferences: [],
  };
}

export function createDefaultVideoFoodMapSettings(): VideoFoodMapSettings {
  return {
    stt: createDefaultRouteSetting(),
    text: createDefaultRouteSetting(),
    diningProfile: createDefaultDiningProfile(),
  };
}

export function listOptionsBySource(
  catalog: VideoFoodMapRuntimeOptionsCatalog | undefined,
  source: VideoFoodMapRouteSource,
): VideoFoodMapRuntimeOption[] {
  return (catalog?.options || []).filter((option) => option.source === source);
}

export function listConnectorOptions(
  catalog: VideoFoodMapRuntimeOptionsCatalog | undefined,
): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  return listOptionsBySource(catalog, 'cloud')
    .filter((option) => {
      if (!option.connectorId || seen.has(option.connectorId)) {
        return false;
      }
      seen.add(option.connectorId);
      return true;
    })
    .map((option) => ({
      value: option.connectorId,
      label: option.connectorLabel || option.provider || option.connectorId,
    }));
}

export function listModelOptions(
  catalog: VideoFoodMapRuntimeOptionsCatalog | undefined,
  setting: VideoFoodMapRouteSetting,
): Array<{ value: string; label: string }> {
  if (!catalog) {
    return [];
  }
  if (setting.routeSource === 'local') {
    return listOptionsBySource(catalog, 'local').map((option) => ({
      value: option.modelId,
      label: option.modelLabel || option.modelId,
    }));
  }
  return listOptionsBySource(catalog, 'cloud')
    .filter((option) => option.connectorId === setting.connectorId)
    .map((option) => ({
      value: option.modelId,
      label: option.modelLabel || option.modelId,
    }));
}

export function buildNextRouteSetting(input: {
  catalog: VideoFoodMapRuntimeOptionsCatalog | undefined;
  current: VideoFoodMapRouteSetting;
  nextSource?: VideoFoodMapRouteSource;
  nextConnectorId?: string;
  nextModel?: string;
}): VideoFoodMapRouteSetting {
  const catalog = input.catalog;
  const source = input.nextSource || input.current.routeSource;
  if (source === 'local') {
    const localOptions = listOptionsBySource(catalog, 'local');
    const nextModel = input.nextModel
      || localOptions.find((option) => option.modelId === input.current.model)?.modelId
      || localOptions[0]?.modelId
      || '';
    return {
      routeSource: 'local',
      connectorId: '',
      model: nextModel,
    };
  }
  const connectorOptions = listConnectorOptions(catalog);
  const connectorId = input.nextConnectorId
    || connectorOptions.find((option) => option.value === input.current.connectorId)?.value
    || connectorOptions[0]?.value
    || '';
  const modelOptions = listOptionsBySource(catalog, 'cloud').filter((option) => option.connectorId === connectorId);
  const model = input.nextModel
    || modelOptions.find((option) => option.modelId === input.current.model)?.modelId
    || modelOptions[0]?.modelId
    || '';
  return {
    routeSource: 'cloud',
    connectorId,
    model,
  };
}
