import { describe, expect, it } from 'vitest';
import {
  distanceKmBetween,
  filterRankedMapPointsByRadius,
  formatDistanceLabel,
  rankMapPointsByDistance,
  type UserLocation,
} from './nearby.js';
import type { MapPoint } from './types.js';

const location: UserLocation = {
  latitude: 23.1291,
  longitude: 113.2644,
  accuracyMeters: 32,
  capturedAt: Date.now(),
};

function buildPoint(overrides: Partial<MapPoint>): MapPoint {
  return {
    venueId: 'venue-1',
    importId: 'import-1',
    venueName: '示例店',
    creatorName: '老王探店',
    title: '广州探店',
    addressText: '广州',
    latitude: 23.13,
    longitude: 113.26,
    isFavorite: false,
    userConfirmed: false,
    ...overrides,
  };
}

describe('nearby helpers', () => {
  it('computes great-circle distance in kilometers', () => {
    const distance = distanceKmBetween(
      { latitude: 23.1291, longitude: 113.2644 },
      { latitude: 23.128, longitude: 113.275 },
    );

    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(2);
  });

  it('ranks map points from nearest to farthest', () => {
    const ranked = rankMapPointsByDistance([
      buildPoint({ venueId: 'far', latitude: 23.2, longitude: 113.5 }),
      buildPoint({ venueId: 'near', latitude: 23.1295, longitude: 113.265 }),
      buildPoint({ venueId: 'mid', latitude: 23.14, longitude: 113.31 }),
    ], location);

    expect(ranked.map((point) => point.venueId)).toEqual(['near', 'mid', 'far']);
  });

  it('filters ranked points by radius', () => {
    const ranked = rankMapPointsByDistance([
      buildPoint({ venueId: 'near', latitude: 23.1295, longitude: 113.265 }),
      buildPoint({ venueId: 'far', latitude: 23.2, longitude: 113.5 }),
    ], location);

    expect(filterRankedMapPointsByRadius(ranked, 3).map((point) => point.venueId)).toEqual(['near']);
  });

  it('formats short and long distances for display', () => {
    expect(formatDistanceLabel(0.42)).toBe('420 米');
    expect(formatDistanceLabel(2.36)).toBe('2.4 公里');
    expect(formatDistanceLabel(12.6)).toBe('13 公里');
  });
});
