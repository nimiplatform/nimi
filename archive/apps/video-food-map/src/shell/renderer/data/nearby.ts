import type { MapPoint } from './types.js';

export type UserLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: number;
};

export type MapPointWithDistance = MapPoint & {
  distanceKm: number;
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceKmBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lngDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine = (
    Math.sin(latDelta / 2) ** 2
    + (Math.cos(fromLatitude) * Math.cos(toLatitude) * (Math.sin(lngDelta / 2) ** 2))
  );
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function rankMapPointsByDistance(points: MapPoint[], location: UserLocation): MapPointWithDistance[] {
  return points
    .map((point) => ({
      ...point,
      distanceKm: distanceKmBetween(location, point),
    }))
    .sort((left, right) => left.distanceKm - right.distanceKm);
}

export function filterRankedMapPointsByRadius(
  points: MapPointWithDistance[],
  radiusKm: number,
): MapPointWithDistance[] {
  return points.filter((point) => point.distanceKm <= radiusKm);
}

export function formatDistanceLabel(distanceKm: number | null | undefined): string {
  if (distanceKm == null || !Number.isFinite(distanceKm)) {
    return '距离未知';
  }
  if (distanceKm < 1) {
    return `${Math.max(50, Math.round(distanceKm * 1000))} 米`;
  }
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} 公里`;
  }
  return `${Math.round(distanceKm)} 公里`;
}

export function formatAccuracyLabel(accuracyMeters: number | null | undefined): string {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return '精度未知';
  }
  if (accuracyMeters < 1000) {
    return `精度约 ${Math.round(accuracyMeters)} 米`;
  }
  return `精度约 ${(accuracyMeters / 1000).toFixed(1)} 公里`;
}
