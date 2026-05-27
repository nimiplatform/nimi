import { describe, expect, it } from 'vitest';
import { buildSectorPath, resolveInitialSectorPath } from './workspace-routes.js';

describe('workspace routes', () => {
  it('builds a direct sector path', () => {
    expect(buildSectorPath('iran')).toBe('/sectors/iran');
  });

  it('prefers the last active custom sector when it still exists', () => {
    expect(resolveInitialSectorPath({
      lastActiveSectorId: 'custom-1',
      officialSectors: [{ id: 'iran', label: 'Iran', slug: 'iran' }],
      customSectors: {
        'custom-1': {
          id: 'custom-1',
          title: 'My Workspace',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })).toBe('/sectors/custom-1');
  });

  it('falls back to the first official sector when the last active sector is missing', () => {
    expect(resolveInitialSectorPath({
      lastActiveSectorId: 'custom-missing',
      officialSectors: [
        { id: 'iran', label: 'Iran', slug: 'iran' },
        { id: 'crypto', label: 'Crypto', slug: 'crypto' },
      ],
      customSectors: {},
    })).toBe('/sectors/iran');
  });
});
